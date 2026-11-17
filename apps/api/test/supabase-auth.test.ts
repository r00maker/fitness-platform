/**
 * Sign-in with Supabase Auth, as in production: the API checks tokens against the project's
 * published keys (JWKS, ES256), with Supabase's issuer and audience, and the dev sign-in is off.
 * A local key server stands in for Supabase.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { db, pool, reset, studio } from "./helpers.js";

let server: Server;
let app: FastifyInstance;
let sign: (claims: Record<string, unknown>, sub: string, opts?: { iss?: string; aud?: string }) => Promise<string>;
const ISS = "https://example-project.supabase.co/auth/v1";

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), alg: "ES256", use: "sig", kid: "test-key" };
  server = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const env = { ...process.env, AUTH_JWKS_URL: `http://127.0.0.1:${port}/auth/v1/.well-known/jwks.json`, AUTH_ISSUER: ISS, AUTH_AUDIENCE: "authenticated" };
  app = await buildApp({ config: loadConfig(env), db });
  sign = (claims, sub, opts = {}) =>
    new SignJWT({ role: "authenticated", ...claims }).setProtectedHeader({ alg: "ES256", kid: "test-key" }).setSubject(sub).setIssuer(opts.iss ?? ISS).setAudience(opts.aud ?? "authenticated").setIssuedAt().setExpirationTime("1h").sign(privateKey);
});
beforeEach(reset);
afterAll(async () => {
  await app.close();
  server.close();
  await pool.end();
});

const call = (token: string, method: "GET" | "POST", url: string, opts: { studio?: string; body?: unknown } = {}) =>
  app.inject({ method, url: `/v1${url}`, headers: { authorization: `Bearer ${token}`, ...(opts.studio ? { "x-studio-id": opts.studio } : {}) }, ...(opts.body !== undefined ? { payload: opts.body as object } : {}) });

describe("Supabase Auth tokens", () => {
  it("a new person signs in with an email code, joins a studio and uses it", async () => {
    const s = await studio();
    const sub = randomUUID();
    // What Supabase puts in an access token after an email code.
    const t = await sign({ email: "nia@example.com", phone: "", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { email: "nia@example.com", email_verified: true, sub }, amr: [{ method: "otp", timestamp: 1 }], session_id: randomUUID(), is_anonymous: false }, sub);
    expect((await call(t, "GET", "/me/studios")).json()).toMatchObject({ hasAccount: false, studios: [] });
    const j = await call(t, "POST", "/join", { studio: s.orgId, body: { firstName: "Nia", lastName: "Tan" } });
    expect(j.statusCode, j.body).toBe(201);
    expect((await call(t, "GET", "/me", { studio: s.orgId })).json()).toMatchObject({ id: sub, email: "nia@example.com", role: "client" });
  });

  it("refuses tokens from another project, for another audience, or signed with another key", async () => {
    const s = await studio();
    expect((await call(await sign({}, s.c1.id, { iss: "https://other.supabase.co/auth/v1" }), "GET", "/me", { studio: s.orgId })).statusCode).toBe(401);
    expect((await call(await sign({}, s.c1.id, { aud: "anon" }), "GET", "/me", { studio: s.orgId })).statusCode).toBe(401);
    const { privateKey } = await generateKeyPair("ES256");
    const forged = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: "test-key" }).setSubject(s.c1.id).setIssuer(ISS).setAudience("authenticated").setExpirationTime("1h").sign(privateKey);
    expect((await call(forged, "GET", "/me", { studio: s.orgId })).statusCode).toBe(401);
    // The right token works.
    expect((await call(await sign({}, s.c1.id), "GET", "/me", { studio: s.orgId })).statusCode).toBe(200);
  });

  it("has no dev sign-in when a real provider is set up", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/dev/sign-in", payload: { email: "a@example.com" } })).statusCode).toBe(404);
  });
});
