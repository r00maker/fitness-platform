ALTER TABLE "migration_jobs" ADD COLUMN "form_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD COLUMN "form_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD COLUMN "sent_intake" jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "uen" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "gst_number" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "instagram" text;