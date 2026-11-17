import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { emailVerified } from "../src/plugins/auth.js";
import { app, config, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

/** A token like the sign-in provider's: no studio in it. */
const providerToken = (sub: string, extra: Record<string, unknown> = {}) =>
  new SignJWT({ email: "new.person@example.com", ...extra }).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setExpirationTime("1h").sign(new TextEncoder().encode(config.AUTH_DEV_SECRET!));
const call = (token: string, method: "GET" | "POST", url: string, opts: { studio?: string; body?: unknown } = {}) =>
  app.inject({ method, url: `/v1${url}`, headers: { authorization: `Bearer ${token}`, ...(opts.studio ? { "x-studio-id": opts.studio } : {}) }, ...(opts.body !== undefined ? { payload: opts.body as object } : {}) });

describe("signing in from the web app", () => {
  it("takes the studio from the X-Studio-Id header, with the role from our records", async () => {
    const s = await studio();
    const t = await providerToken(s.c1.id);
    const me = await call(t, "GET", "/me", { studio: s.orgId });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: s.c1.id, role: "client", orgId: s.orgId });
    // No studio at all: asked to choose one.
    expect((await call(t, "GET", "/me")).json().error.code).toBe("studio_needed");
    // A studio they don't belong to: refused, whatever the header says.
    const other = await studio();
    expect((await call(t, "GET", "/me", { studio: other.orgId })).statusCode).toBe(403);
    // A user id that isn't one of ours (not a UUID) is refused.
    expect((await call(await providerToken("auth0|abc"), "GET", "/me", { studio: s.orgId })).statusCode).toBe(401);
  });

  it("lists the studios someone belongs to", async () => {
    const s = await studio();
    const t = await providerToken(s.owner.id);
    const r = await call(t, "GET", "/me/studios");
    expect(r.json()).toMatchObject({ hasAccount: true, firstName: "Olivia", studios: [{ id: s.orgId, name: "Test Studio", role: "owner" }] });
    expect((await app.inject({ method: "GET", url: "/v1/me/studios" })).statusCode).toBe(401);
  });

  it("a new person signs in and joins a studio through the header", async () => {
    const s = await studio();
    const sub = crypto.randomUUID();
    const t = await providerToken(sub, { user_metadata: { email_verified: true } });
    expect((await call(t, "GET", "/me/studios")).json()).toMatchObject({ hasAccount: false, studios: [] });
    const j = await call(t, "POST", "/join", { studio: s.orgId, body: { firstName: "Nia", lastName: "Tan", marketingEmail: false, marketingPush: false, marketingWhatsapp: false } });
    expect(j.statusCode, j.body).toBe(201);
    expect((await call(t, "GET", "/me", { studio: s.orgId })).json()).toMatchObject({ id: sub, firstName: "Nia", role: "client" });
  });

  it("knows a confirmed email from the provider's claims", () => {
    expect(emailVerified({ email_verified: true })).toBe(true);
    expect(emailVerified({ user_metadata: { email_verified: true } })).toBe(true);
    expect(emailVerified({ amr: [{ method: "otp", timestamp: 1 }] })).toBe(true);
    expect(emailVerified({ amr: [{ method: "password", timestamp: 1 }] })).toBe(false);
    expect(emailVerified({})).toBe(false);
  });

  it("local development has a sign-in for any email (not when a real provider is set up)", async () => {
    const s = await studio();
    const r = await app.inject({ method: "POST", url: "/v1/dev/sign-in", payload: { email: "Owner1@Example.com" } });
    expect(r.statusCode).toBe(200);
    const { token, existing, userId } = r.json();
    expect(existing).toBe(false); // helpers' owner has a different email number
    expect((await call(token, "GET", "/me/studios")).statusCode).toBe(200);
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    void s;
  });
});
