import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { and, eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { can, type Permission, type Role } from "@studio/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { memberships } from "../db/schema.js";
import { forbidden, unauthorized } from "../lib/errors.js";

export interface AuthContext {
  userId: string;
  orgId: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

/**
 * Sign-in itself is handled by a dedicated identity provider (passwords, social
 * login, 2FA, password resets). The API only verifies the signed token it issues,
 * then looks up the person's role in this studio from our own database, so a
 * token can never grant itself extra permissions.
 *
 * Expected token claims: `sub` = our user id, `org` = studio id.
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
    const orgId = typeof payload.org === "string" ? payload.org : undefined;
    if (!userId || !orgId) throw unauthorized();

    const [m] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId), eq(memberships.active, true)))
      .limit(1);
    if (!m) throw forbidden("You're not a member of this studio.");
    req.auth = { userId, orgId, role: m.role };
  });
}

declare module "fastify" {
  interface FastifyContextConfig {
    public?: boolean;
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
