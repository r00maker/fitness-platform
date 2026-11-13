import { z } from "zod";

/** All configuration comes from environment variables, validated at startup. Secrets never live in code. */
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().default(3000),
    DATABASE_URL: z.string().url(),
    /** Comma-separated list of web origins allowed to call the API. */
    CORS_ORIGINS: z.string().default("http://localhost:5173"),
    /** Production: your auth provider's JWKS URL. Development/test: a shared secret instead. */
    AUTH_JWKS_URL: z.string().url().optional(),
    AUTH_ISSUER: z.string().optional(),
    AUTH_AUDIENCE: z.string().optional(),
    AUTH_DEV_SECRET: z.string().min(32).optional(),
    /**
     * How many proxies (load balancers) sit in front of the API. The client's real address is
     * read from X-Forwarded-For only that many hops back, so it can't be faked to dodge rate
     * limits. 1 suits most hosts (Render, Fly, Railway, a single AWS load balancer); 0 = none.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    EMAIL_PROVIDER: z.enum(["console", "postmark"]).default("console"),
    POSTMARK_TOKEN: z.string().optional(),
    EMAIL_FROM: z.string().default("Studio <no-reply@example.com>"),
    PUSH_PROVIDER: z.enum(["console", "expo"]).default("console"),
    /** Where the API can be reached from outside (used for images and unsubscribe links in emails). */
    PUBLIC_API_URL: z.string().url().default("http://localhost:3000"),
    /** 64 hex characters. Encrypts stored access tokens (Meta). Generate with: openssl rand -hex 32 */
    SECRETS_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
    /** Meta (Facebook/Instagram) app: verifies lead webhooks. Set both to receive Lead Ads. */
    META_APP_SECRET: z.string().min(8).optional(),
    META_VERIFY_TOKEN: z.string().min(8).optional(),
  /** Meta app id, used to finish WhatsApp sign-up (Embedded Signup) for studios. */
  META_APP_ID: z.string().regex(/^\d{5,25}$/).optional(),
  /**
   * WhatsApp prices the platform charges studios that buy message credits, in US cents per message,
   * by country calling code and category, e.g. {"65":{"marketing":6.5,"utility":2.2}}. Copy from Meta's
   * current rate card (plus any margin). Leave unset until the platform pays Meta on studios' behalf:
   * without it, studios can only pay Meta directly.
   */
  WHATSAPP_RATE_CARD: z.string().optional(),
    META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v21.0"),
    /** The client app's web address (used for referral links and buttons in emails). */
    PUBLIC_APP_URL: z.string().url().default("http://localhost:5173"),
    /**
     * Support assistant (Claude API). One key for the whole platform, kept on the server only.
     * Without it, the assistant says it isn't set up yet; everything else works as normal.
     */
    ANTHROPIC_API_KEY: z.string().min(10).optional(),
    ASSISTANT_MODEL: z.string().default("claude-opus-5-5"),
    /** Assistant replies included per studio per month (studios can buy top-ups for more). */
    ASSISTANT_MONTHLY_REPLIES: z.coerce.number().int().min(0).default(300),
    /** Kill switch: turn the assistant off for every studio at once. */
    ASSISTANT_DISABLED: z.stringbool().default(false),
    /** Where the help guide lives (the assistant reads it). Defaults to ./docs next to the app. */
    HELP_DOCS_DIR: z.string().optional(),
    /** How far ahead recurring classes are created on the calendar. */
    SERIES_HORIZON_DAYS: z.coerce.number().int().min(7).max(730).default(120),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.AUTH_JWKS_URL) {
      ctx.addIssue({ code: "custom", message: "AUTH_JWKS_URL is required in production" });
    }
    if (env.NODE_ENV === "production" && (!env.AUTH_ISSUER || !env.AUTH_AUDIENCE)) {
      ctx.addIssue({ code: "custom", message: "AUTH_ISSUER and AUTH_AUDIENCE are required in production, so only tokens your sign-in provider issued for this app are accepted" });
    }
    if (env.NODE_ENV === "production" && env.AUTH_DEV_SECRET) {
      ctx.addIssue({ code: "custom", message: "AUTH_DEV_SECRET must not be set in production" });
    }
    if (env.NODE_ENV !== "production" && !env.AUTH_JWKS_URL && !env.AUTH_DEV_SECRET) {
      ctx.addIssue({ code: "custom", message: "Set AUTH_DEV_SECRET (32+ chars) for local development" });
    }
  });

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  return parsed.data;
}
