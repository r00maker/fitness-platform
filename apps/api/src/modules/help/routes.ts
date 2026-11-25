/**
 * The help centre (apps/help), for studio staff only, never public.
 *
 *  - GET /v1/help/link   signed in, staff only (not clients): a link to the help centre that works
 *                        for 12 hours. The studio app opens it in a new tab.
 *  - GET /help/?key=...  checks the link, keeps it in a cookie for /help only, and sends the
 *                        browser on to /help/ without the key in the address.
 *  - GET /help/          the help centre, and /help/img/... its screenshots, with that cookie.
 *
 * Without a valid link or cookie, /help is "not found". Every response says not to index it.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";
import type { Config } from "../../config.js";
import { AppError, forbidden } from "../../lib/errors.js";

const HOURS = 12;
const COOKIE = "skedoo_help";
const AUDIENCE = "skedoo-help";
const STAFF = new Set(["owner", "admin", "front_desk", "instructor"]);

/** Where the built help centre is: HELP_SITE_DIR, /app/help in the container, or apps/help/dist. */
function siteDir(config: Config): string | null {
  const candidates = [config.HELP_SITE_DIR, path.resolve(process.cwd(), "help"), path.resolve(process.cwd(), "../help/dist"), path.resolve(process.cwd(), "apps/help/dist")].filter((x): x is string => !!x);
  return candidates.find((d) => existsSync(path.join(d, "index.html"))) ?? null;
}

/** The signing key: HELP_LINK_SECRET, or (outside production only) the dev sign-in secret. */
function secret(config: Config): Uint8Array | null {
  const s = config.HELP_LINK_SECRET ?? (config.NODE_ENV !== "production" ? config.AUTH_DEV_SECRET : undefined);
  return s ? new TextEncoder().encode(s) : null;
}

let page: { dir: string; html: string; csp: string } | null = null;
function load(dir: string) {
  if (page?.dir === dir) return page;
  const html = readFileSync(path.join(dir, "index.html"), "utf8");
  // The page's own script is allowed by its hash; nothing else may run.
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash("sha256").update(m[1]!).digest("base64")}'`);
  const csp = [
    "default-src 'none'",
    `script-src ${hashes.join(" ")}`,
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  page = { dir, html, csp };
  return page;
}

const cookieOf = (req: FastifyRequest) => req.headers.cookie?.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);

const NOT_FOUND = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Skedoo Help Centre</title></head>
<body style="font:16px/1.6 system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px;color:#17201c">
<h1 style="font-size:22px">This page isn't available</h1>
<p>The Skedoo help centre is for Skedoo studios. Open it from <b>Help centre</b> in your studio app. Links last 12 hours, so if yours has expired, open it from the app again.</p></body></html>`;

export async function helpLinkRoutes(app: FastifyInstance) {
  const { config } = app;
  app.get("/help/link", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    if (!STAFF.has(req.auth.role)) throw forbidden("The help centre is for your studio's team.");
    const key = secret(config);
    if (!key || !siteDir(config)) throw new AppError(503, "help_unavailable", "The help centre isn't available right now. Please try again later.");
    const expires = new Date(Date.now() + HOURS * 3_600_000);
    const token = await new SignJWT({ org: req.auth.orgId }).setProtectedHeader({ alg: "HS256" }).setSubject(req.auth.userId).setAudience(AUDIENCE).setIssuedAt().setExpirationTime(Math.floor(expires.getTime() / 1000)).sign(key);
    return { url: `${config.PUBLIC_API_URL.replace(/\/$/, "")}/help/?key=${token}`, expiresAt: expires.toISOString() };
  });
}

export async function helpSiteRoutes(app: FastifyInstance) {
  const { config } = app;
  const valid = async (token: string | undefined) => {
    const key = secret(config);
    if (!token || !key) return false;
    try { await jwtVerify(token, key, { audience: AUDIENCE, algorithms: ["HS256"] }); return true; } catch { return false; }
  };
  const base = (reply: FastifyReply) => reply.header("x-robots-tag", "noindex, nofollow").header("referrer-policy", "no-referrer");
  const notFound = (reply: FastifyReply) => base(reply).code(404).header("cache-control", "no-store").type("text/html; charset=utf-8").send(NOT_FOUND);

  app.get("/help", (_req, reply) => base(reply).redirect("/help/", 301));
  app.get("/help/", async (req, reply) => {
    const key = (req.query as { key?: string }).key;
    if (key) {
      // From the app: keep the link in a cookie for /help only, and drop it from the address.
      if (!(await valid(key))) return notFound(reply);
      const secure = config.NODE_ENV === "production" || config.PUBLIC_API_URL.startsWith("https:") ? "; Secure" : "";
      return base(reply).header("set-cookie", `${COOKIE}=${key}; Path=/help; Max-Age=${HOURS * 3600}; HttpOnly; SameSite=Lax${secure}`).header("cache-control", "no-store").redirect("/help/", 302);
    }
    const dir = siteDir(config);
    if (!dir || !(await valid(cookieOf(req)))) return notFound(reply);
    const p = load(dir);
    return base(reply).header("cache-control", "private, no-store").header("content-security-policy", p.csp).type("text/html; charset=utf-8").send(p.html);
  });
  app.get("/help/img/:file", async (req, reply) => {
    const { file } = req.params as { file: string };
    const dir = siteDir(config);
    if (!/^[a-z0-9-]+\.webp$/.test(file) || !dir || !(await valid(cookieOf(req)))) return notFound(reply);
    const f = path.join(dir, "img", file);
    if (!existsSync(f)) return notFound(reply);
    return base(reply).header("cache-control", "private, max-age=3600").type("image/webp").send(readFileSync(f));
  });
}
