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
    META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v21.0"),
    /** The client app's web address (used for referral links and buttons in emails). */
    PUBLIC_APP_URL: z.string().url().default("http://localhost:5173"),
    /** How far ahead recurring classes are created on the calendar. */
    SERIES_HORIZON_DAYS: z.coerce.number().int().min(7).max(730).default(120),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.AUTH_JWKS_URL) {
      ctx.addIssue({ code: "custom", message: "AUTH_JWKS_URL is required in production" });
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
