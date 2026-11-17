import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { and, eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { can, type Permission, type Role } from "@studio/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { memberships } from "../db/schema.js";
import { badRequest, forbidden, unauthorized } from "../lib/errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Has the sign-in provider confirmed the person's email? `email_verified` (most providers), or
 * Supabase's `user_metadata.email_verified`, or a sign-in by a link or code sent to that email.
 */
export function emailVerified(p: JWTPayload): boolean {
  const meta = (p.user_metadata ?? {}) as Record<string, unknown>;
  const yes = (v: unknown) => v === true || v === "true";
  const amr = Array.isArray(p.amr) ? (p.amr as { method?: string }[]).map((a) => (typeof a === "string" ? a : a?.method)) : [];
  return yes(p.email_verified) || yes(meta.email_verified) || amr.some((m) => m === "otp" || m === "magiclink");
}

export interface AuthContext {
  userId: string;
  orgId: string;
  role: Role;
  /** Signed in, but not a member of this studio yet (only on the join route). */
  joining?: boolean;
  /** Joining: the email the sign-in provider vouched for. */
  email?: string;
  /** Joining: the provider says the person has confirmed that email address. */
  emailVerified?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
  interface FastifyInstance {
    /** Check a sign-in token's signature and claims (used by HQ routes, which have no studio). */
    verifyToken: (token: string) => Promise<JWTPayload>;
  }
}

/**
 * Sign-in itself is handled by a dedicated identity provider (passwords, social
 * login, 2FA, password resets). The API only verifies the signed token it issues,
 * then looks up the person's role in this studio from our own database, so a
 * token can never grant itself extra permissions.
 *
 * Expected token claims: `sub` = our user id (a UUID; Supabase Auth's user ids are used as ours).
 * The studio comes from the `X-Studio-Id` header (the web and mobile apps send the studio being
 * used), or from an `org` claim. Either way the person's role is read from our database, so a
 * header or claim can't grant anything: someone who isn't a member is refused.
 */
async function authPlugin(app: FastifyInstance, opts: { config: Config; db: Db }) {
  const { config, db } = opts;
  const jwks = config.AUTH_JWKS_URL ? createRemoteJWKSet(new URL(config.AUTH_JWKS_URL)) : null;
  const devKey = config.AUTH_DEV_SECRET ? new TextEncoder().encode(config.AUTH_DEV_SECRET) : null;

  async function verify(token: string): Promise<JWTPayload> {
    const options = { issuer: config.AUTH_ISSUER, audience: config.AUTH_AUDIENCE };
    if (jwks) return (await jwtVerify(token, jwks, options)).payload;
    if (devKey) return (await jwtVerify(token, devKey, { ...options, algorithms: ["HS256"] })).payload;
    throw unauthorized();
  }

  app.decorate("verifyToken", verify);
  app.decorateRequest("auth", null as unknown as AuthContext);
  app.addHook("onRequest", async (req: FastifyRequest) => {
    if (req.routeOptions.config?.public) return;
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized();
    let payload: JWTPayload;
    try {
      payload = await verify(header.slice(7));
    } catch {
      throw unauthorized();
    }
    const userId = payload.sub;
    const header0 = req.headers["x-studio-id"];
    const studioHeader = typeof header0 === "string" && UUID.test(header0) ? header0 : undefined;
    const orgId = studioHeader ?? (typeof payload.org === "string" ? payload.org : undefined);
    if (!userId || !UUID.test(userId)) throw unauthorized();
    if (!orgId) throw badRequest("studio_needed", "Choose a studio first.");

    const [m] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId), eq(memberships.active, true)))
      .limit(1);
    if (!m) {
      // Only the join route accepts someone who isn't a member yet; it makes them a client.
      if (req.routeOptions.config?.joining) {
        req.auth = {
          userId,
          orgId,
          role: "client",
          joining: true,
          email: typeof payload.email === "string" ? payload.email : undefined,
          emailVerified: emailVerified(payload),
        };
        return;
      }
      throw forbidden("You're not a member of this studio.");
    }
    req.auth = { userId, orgId, role: m.role };
  });
}

declare module "fastify" {
  interface FastifyContextConfig {
    public?: boolean;
    joining?: boolean;
  }
}

export default fp(authPlugin, { name: "auth" });

export function requirePermission(req: FastifyRequest, permission: Permission): void {
  if (!can(req.auth.role, permission)) throw forbidden();
}

export function requireRole(req: FastifyRequest, roles: readonly Role[]): void {
  if (!roles.includes(req.auth.role)) throw forbidden();
}

export const isStaff = (role: Role) => role !== "client";
