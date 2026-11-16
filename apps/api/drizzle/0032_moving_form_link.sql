ALTER TABLE "migration_jobs" ADD COLUMN "form_token_hash" text;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD COLUMN "form_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD COLUMN "form_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD COLUMN "form_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD COLUMN "form_submitted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "migration_jobs_form_token_uq" ON "migration_jobs" USING btree ("form_token_hash");