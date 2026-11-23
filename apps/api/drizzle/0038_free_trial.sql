ALTER TABLE "organizations" ADD COLUMN "trial_kind" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_converted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_plan_request" jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_terms_version" text;