ALTER TYPE "public"."package_ledger_reason" ADD VALUE 'start_moved' BEFORE 'rolled_over';--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "planned_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "extra_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Packages that start when bought keep the start they were sold with as the latest the start can be.
UPDATE "client_packages" SET "planned_start_at" = "started_at" WHERE "starts_on" = 'purchase' AND "billing" = 'one_time';
