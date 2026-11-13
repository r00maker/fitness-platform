import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { app, caller, config, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const tokenWith = (claims: Record<string, unknown>, userId: string, orgId: string) =>
  new SignJWT({ org: orgId, ...claims }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setExpirationTime("1h").sign(new TextEncoder().encode(config.AUTH_DEV_SECRET!));

describe("security", () => {
  it("only lets a new person join with an email address they've confirmed", async () => {
    const s = await studio();
    const body = { firstName: "Mallory", lastName: "Doe", marketingEmail: false, marketingPush: false };
    // An unconfirmed address could belong to someone else (and later match a staff invite sent to it).
    const unverified = caller(await tokenWith({ email: "olivia.owner@example.com" }, randomUUID(), s.orgId));
    const r1 = await unverified("POST", "/join", body);
    expect(r1.status).toBe(403);
    expect(r1.body.error.message).toMatch(/confirm your email/);
    const verified = caller(await tokenWith({ email: "mallory@example.com", email_verified: true }, randomUUID(), s.orgId));
    expect((await verified("POST", "/join", body)).status).toBe(201);
  });

  it("can't dodge the rate limit by sending made-up sign-in tokens", async () => {
    let limited = 0;
    // e.g. guessing staff invite links (limited to 30 a minute per address)
    for (let i = 0; i < 40; i++) {
      const res = await app.inject({ method: "GET", url: `/v1/public/staff-invites/${"a".repeat(48)}`, headers: { authorization: `Bearer ${"x".repeat(30)}-made-up-token-${i}` } });
      if (res.statusCode === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it("refuses to start in production without the sign-in provider's issuer and audience", () => {
    const base = { NODE_ENV: "production", DATABASE_URL: "postgres://x@localhost/db", AUTH_JWKS_URL: "https://auth.example.com/.well-known/jwks.json" };
    expect(() => loadConfig(base)).toThrow(/AUTH_ISSUER and AUTH_AUDIENCE are required/);
    expect(() => loadConfig({ ...base, AUTH_ISSUER: "https://auth.example.com", AUTH_AUDIENCE: "studio-app" })).not.toThrow();
  });
});
