CREATE TYPE "public"."booking_payment" AS ENUM('package', 'complimentary', 'pay_later');--> statement-breakpoint
CREATE TYPE "public"."package_ledger_reason" AS ENUM('purchase', 'booked', 'returned', 'refunded', 'adjusted');--> statement-breakpoint
CREATE TYPE "public"."package_kind" AS ENUM('credits', 'unlimited');--> statement-breakpoint
CREATE TYPE "public"."package_start" AS ENUM('purchase', 'first_booking');--> statement-breakpoint
CREATE TYPE "public"."pay_headcount" AS ENUM('attended', 'booked');--> statement-breakpoint
CREATE TYPE "public"."pay_period" AS ENUM('weekly', 'fortnightly', 'twice_monthly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."pay_rate_type" AS ENUM('per_class', 'per_client', 'tiered', 'hourly', 'salary');--> statement-breakpoint
CREATE TYPE "public"."sharing_mode" AS ENUM('pool', 'allocated');--> statement-breakpoint
CREATE TYPE "public"."validity_unit" AS ENUM('days', 'weeks', 'months');--> statement-breakpoint
CREATE TABLE "client_package_members" (
	"org_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"allocated_credits" integer,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_member_alloc_ok" CHECK ("client_package_members"."allocated_credits" is null or "client_package_members"."allocated_credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "client_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan_id" uuid,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "package_kind" NOT NULL,
	"credits_total" integer,
	"credits_left" integer,
	"validity_value" integer,
	"validity_unit" "validity_unit",
	"starts_on" "package_start" NOT NULL,
	"activate_by" timestamp with time zone,
	"started_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"max_users" integer DEFAULT 1 NOT NULL,
	"sharing_mode" "sharing_mode",
	"weekly_limit" integer,
	"class_type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"price_paid_cents" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"sold_by" uuid,
	"note" text,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_packages_credits_ok" CHECK ("client_packages"."credits_left" is null or "client_packages"."credits_left" >= 0)
);
--> statement-breakpoint
CREATE TABLE "package_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"user_id" uuid,
	"booking_id" uuid,
	"change" integer NOT NULL,
	"reason" "package_ledger_reason" NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" "package_kind" NOT NULL,
	"credits" integer,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"validity_value" integer,
	"validity_unit" "validity_unit",
	"starts_on" "package_start" DEFAULT 'purchase' NOT NULL,
	"activate_within_days" integer,
	"max_users" integer DEFAULT 1 NOT NULL,
	"sharing_mode" "sharing_mode",
	"weekly_limit" integer,
	"class_type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"on_sale" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"class_type_id" uuid,
	"type" "pay_rate_type" NOT NULL,
	"amount_cents" integer,
	"per_client_cents" integer,
	"clients_included" integer,
	"minimum_cents" integer,
	"tiers" jsonb,
	"effective_from" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"total_cents" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"paid_by" uuid,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payment" "booking_payment" DEFAULT 'pay_later' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "client_package_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "clients_need_package" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "pay_period" "pay_period" DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "pay_period_anchor" date;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "pay_headcount" "pay_headcount" DEFAULT 'attended' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "instructors_see_own_pay" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "client_package_members" ADD CONSTRAINT "client_package_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_package_members" ADD CONSTRAINT "client_package_members_package_id_client_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."client_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_package_members" ADD CONSTRAINT "client_package_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_package_members" ADD CONSTRAINT "client_package_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_plan_id_package_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."package_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_sold_by_users_id_fk" FOREIGN KEY ("sold_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_ledger" ADD CONSTRAINT "package_ledger_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_ledger" ADD CONSTRAINT "package_ledger_package_id_client_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."client_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_ledger" ADD CONSTRAINT "package_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_ledger" ADD CONSTRAINT "package_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_plans" ADD CONSTRAINT "package_plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_adjustments" ADD CONSTRAINT "pay_adjustments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_adjustments" ADD CONSTRAINT "pay_adjustments_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_adjustments" ADD CONSTRAINT "pay_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rates" ADD CONSTRAINT "pay_rates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rates" ADD CONSTRAINT "pay_rates_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rates" ADD CONSTRAINT "pay_rates_class_type_id_class_types_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."class_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_rates" ADD CONSTRAINT "pay_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_runs" ADD CONSTRAINT "pay_runs_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "package_member_uq" ON "client_package_members" USING btree ("package_id","user_id");--> statement-breakpoint
CREATE INDEX "package_member_user_idx" ON "client_package_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "client_packages_owner_idx" ON "client_packages" USING btree ("org_id","owner_id");--> statement-breakpoint
CREATE INDEX "package_ledger_pkg_idx" ON "package_ledger" USING btree ("package_id","created_at");--> statement-breakpoint
CREATE INDEX "pay_adjustments_idx" ON "pay_adjustments" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "pay_rates_staff_idx" ON "pay_rates" USING btree ("org_id","staff_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_runs_period_uq" ON "pay_runs" USING btree ("org_id","period_start");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_package_id_client_packages_id_fk" FOREIGN KEY ("client_package_id") REFERENCES "public"."client_packages"("id") ON DELETE no action ON UPDATE no action;