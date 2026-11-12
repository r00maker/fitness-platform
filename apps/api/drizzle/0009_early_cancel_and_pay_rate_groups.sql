CREATE TYPE "public"."early_cancel_fee_mode" AS ENUM('none', 'flat', 'remaining');--> statement-breakpoint
ALTER TYPE "public"."fee_type" ADD VALUE 'early_cancellation';--> statement-breakpoint
ALTER TABLE "pay_rates" DROP CONSTRAINT "pay_rates_class_type_id_class_types_id_fk";
--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "ends_early" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "early_cancel_fee_mode" "early_cancel_fee_mode" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "early_cancel_fee_cents" integer;--> statement-breakpoint
ALTER TABLE "package_plans" ADD COLUMN "early_cancel_fee_mode" "early_cancel_fee_mode" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "package_plans" ADD COLUMN "early_cancel_fee_cents" integer;--> statement-breakpoint
ALTER TABLE "pay_rates" ADD COLUMN "class_type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
-- Existing per-class-type rates become one-item groups.
UPDATE "pay_rates" SET "class_type_ids" = ARRAY["class_type_id"] WHERE "class_type_id" IS NOT NULL;