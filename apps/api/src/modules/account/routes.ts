/**
 * Signed in, before choosing a studio.
 *
 *  - GET  /me/studios   the studios this person belongs to (for the app's studio switcher).
 *  - POST /dev/sign-in  local development only: a sign-in token for an email, so the web app can
 *                       be run and tested without the real sign-in provider. It doesn't exist when
 *                       a real provider is configured (AUTH_JWKS_URL) or in production.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, asc, eq, sql } from "drizzle-orm";
import { SignJWT } from "jose";
import { z } from "zod";
import { memberships, organizations, users } from "../../db/schema.js";
import { unauthorized } from "../../lib/errors.js";
import { parse } from "../../lib/validate.js";

const devSignIn = z.object({ email: z.email("Enter an email address.").max(200) });

export async function accountRoutes(app: FastifyInstance) {
  const { db, config } = app;

  app.get("/me/studios", { config: { public: true, rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized();
    let sub: string | undefined;
    try {
      sub = (await app.verifyToken(header.slice(7))).sub;
    } catch {
      throw unauthorized();
    }
    if (!sub) throw unauthorized();
    const rows = await db
      .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(memberships.userId, sub), eq(memberships.active, true)))
      .orderBy(asc(organizations.name));
    const [u] = await db.select({ firstName: users.firstName }).from(users).where(eq(users.id, sub));
    return { hasAccount: !!u, firstName: u?.firstName ?? null, studios: rows };
  });

  if (config.NODE_ENV !== "production" && config.AUTH_DEV_SECRET && !config.AUTH_JWKS_URL) {
    const key = new TextEncoder().encode(config.AUTH_DEV_SECRET);
    app.post("/dev/sign-in", { config: { public: true, rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
      const { email } = parse(devSignIn, req.body);
      const [u] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
      const sub = u?.id ?? randomUUID();
      let jwt = new SignJWT({ email: email.toLowerCase(), email_verified: true }).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("12h");
      if (config.AUTH_ISSUER) jwt = jwt.setIssuer(config.AUTH_ISSUER);
      if (config.AUTH_AUDIENCE) jwt = jwt.setAudience(config.AUTH_AUDIENCE);
      return { token: await jwt.sign(key), userId: sub, existing: !!u };
    });
  }
}
