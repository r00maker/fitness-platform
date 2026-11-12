CREATE TYPE "public"."extension_attachment" AS ENUM('off', 'optional', 'required');--> statement-breakpoint
CREATE TYPE "public"."extension_fee_mode" AS ENUM('free', 'flat', 'per_week');--> statement-breakpoint
CREATE TYPE "public"."extension_mode" AS ENUM('off', 'review', 'auto');--> statement-breakpoint
CREATE TYPE "public"."extension_status" AS ENUM('pending', 'approved', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."file_purpose" AS ENUM('package_photo', 'extension_attachment');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."package_billing" AS ENUM('one_time', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."rollover_mode" AS ENUM('off', 'staff', 'clients');--> statement-breakpoint
ALTER TYPE "public"."fee_type" ADD VALUE 'package_extension';--> statement-breakpoint
ALTER TYPE "public"."package_ledger_reason" ADD VALUE 'activated';--> statement-breakpoint
ALTER TYPE "public"."package_ledger_reason" ADD VALUE 'extended';--> statement-breakpoint
ALTER TYPE "public"."package_ledger_reason" ADD VALUE 'expiry_changed';--> statement-breakpoint
ALTER TYPE "public"."package_ledger_reason" ADD VALUE 'rolled_over';--> statement-breakpoint
ALTER TYPE "public"."package_ledger_reason" ADD VALUE 'renewed';--> statement-breakpoint
ALTER TYPE "public"."package_ledger_reason" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."package_ledger_reason" ADD VALUE 'plan_updated';--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"purpose" "file_purpose" NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"plan_id" uuid,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"start_date" date,
	"rollover_from_package_id" uuid,
	"client_package_id" uuid,
	"provider" text,
	"provider_ref" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_extension_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"days" integer NOT NULL,
	"reason" text NOT NULL,
	"attachment_file_id" uuid,
	"status" "extension_status" DEFAULT 'pending' NOT NULL,
	"auto_approved" boolean DEFAULT false NOT NULL,
	"days_granted" integer,
	"fee_cents" integer,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fees" ALTER COLUMN "booking_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "billing" "package_billing" DEFAULT 'one_time' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "rollover_cap" integer;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "commitment_cycles" integer;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "credits_per_cycle" integer;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "cycle" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "stops_renewing_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fees" ADD COLUMN "client_package_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "extension_mode" "extension_mode" DEFAULT 'review' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "extension_auto_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "extension_max_days" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "extension_attachment" "extension_attachment" DEFAULT 'optional' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "extension_fee_mode" "extension_fee_mode" DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "extension_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "rollover_mode" "rollover_mode" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "rollover_max_credits" integer;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "rollover_within_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "package_ledger" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "package_plans" ADD COLUMN "photo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "package_plans" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "package_plans" ADD COLUMN "billing" "package_billing" DEFAULT 'one_time' NOT NULL;--> statement-breakpoint
ALTER TABLE "package_plans" ADD COLUMN "rollover_cap" integer;--> statement-breakpoint
ALTER TABLE "package_plans" ADD COLUMN "commitment_cycles" integer;--> statement-breakpoint
ALTER TABLE "package_plans" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_plan_id_package_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."package_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_rollover_from_package_id_client_packages_id_fk" FOREIGN KEY ("rollover_from_package_id") REFERENCES "public"."client_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_package_id_client_packages_id_fk" FOREIGN KEY ("client_package_id") REFERENCES "public"."client_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_categories" ADD CONSTRAINT "package_categories_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_extension_requests" ADD CONSTRAINT "package_extension_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_extension_requests" ADD CONSTRAINT "package_extension_requests_package_id_client_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."client_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_extension_requests" ADD CONSTRAINT "package_extension_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_extension_requests" ADD CONSTRAINT "package_extension_requests_attachment_file_id_files_id_fk" FOREIGN KEY ("attachment_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_extension_requests" ADD CONSTRAINT "package_extension_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_org_idx" ON "files" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "orders_client_idx" ON "orders" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "extension_requests_org_idx" ON "package_extension_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "extension_one_pending" ON "package_extension_requests" USING btree ("package_id") WHERE "package_extension_requests"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "fees" ADD CONSTRAINT "fees_client_package_id_client_packages_id_fk" FOREIGN KEY ("client_package_id") REFERENCES "public"."client_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_plans" ADD CONSTRAINT "package_plans_photo_file_id_files_id_fk" FOREIGN KEY ("photo_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_plans" ADD CONSTRAINT "package_plans_category_id_package_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."package_categories"("id") ON DELETE set null ON UPDATE no action;