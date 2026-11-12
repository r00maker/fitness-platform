CREATE TYPE "public"."acquisition_channel" AS ENUM('meta_ads', 'google_ads', 'referral', 'other_campaign', 'direct');--> statement-breakpoint
CREATE TYPE "public"."banner_link" AS ENUM('none', 'package', 'category', 'class_type', 'gift_cards', 'referrals', 'url');--> statement-breakpoint
CREATE TYPE "public"."banner_placement" AS ENUM('home', 'packages', 'schedule');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'sent', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."credit_reason" AS ENUM('granted', 'used', 'returned', 'expired', 'adjusted');--> statement-breakpoint
CREATE TYPE "public"."credit_source" AS ENUM('gift_card', 'referral', 'journey', 'studio');--> statement-breakpoint
CREATE TYPE "public"."email_purpose" AS ENUM('marketing', 'service');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'completed', 'exited');--> statement-breakpoint
CREATE TYPE "public"."gift_card_status" AS ENUM('pending_payment', 'unsent', 'given', 'kept', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."journey_status" AS ENUM('draft', 'live', 'paused');--> statement-breakpoint
CREATE TYPE "public"."order_kind" AS ENUM('package', 'gift_card');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('pending', 'rewarded', 'capped', 'expired', 'void');--> statement-breakpoint
ALTER TYPE "public"."file_purpose" ADD VALUE 'email_image';--> statement-breakpoint
ALTER TYPE "public"."file_purpose" ADD VALUE 'banner';--> statement-breakpoint
ALTER TYPE "public"."file_purpose" ADD VALUE 'gift_card_design';--> statement-breakpoint
CREATE TABLE "announcement_dismissals" (
	"announcement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"importance" text DEFAULT 'info' NOT NULL,
	"audience" text DEFAULT 'everyone' NOT NULL,
	"location_id" uuid,
	"booked_within_days" integer DEFAULT 7 NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"send_push" boolean DEFAULT true NOT NULL,
	"pushed_to" integer,
	"ended_early_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"image_file_id" uuid NOT NULL,
	"placement" "banner_placement" DEFAULT 'home' NOT NULL,
	"link_type" "banner_link" DEFAULT 'none' NOT NULL,
	"link_target" text,
	"audience" text DEFAULT 'everyone' NOT NULL,
	"segment_id" uuid,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"remaining_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"source" "credit_source" NOT NULL,
	"source_id" uuid,
	"note" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_remaining_ok" CHECK ("credit_grants"."remaining_cents" >= 0 and "credit_grants"."remaining_cents" <= "credit_grants"."amount_cents")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"grant_id" uuid,
	"change" integer NOT NULL,
	"reason" "credit_reason" NOT NULL,
	"order_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email_id" uuid NOT NULL,
	"segment_id" uuid,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"send_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"recipients" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"purpose" "email_purpose" DEFAULT 'marketing' NOT NULL,
	"design" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_card_designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"file_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"design_id" uuid,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"buyer_id" uuid NOT NULL,
	"recipient_id" uuid,
	"status" "gift_card_status" DEFAULT 'pending_payment' NOT NULL,
	"from_name" text,
	"message" text,
	"give_by" timestamp with time zone,
	"given_at" timestamp with time zone,
	"credit_grant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journey_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"path" jsonb NOT NULL,
	"status" "enrollment_status" DEFAULT 'active' NOT NULL,
	"next_run_at" timestamp with time zone,
	"waiting_for" jsonb,
	"trigger_ref" text,
	"exit_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "journey_segment_members" (
	"journey_id" uuid NOT NULL,
	"client_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journey_step_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"outcome" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"reentry" text DEFAULT 'once' NOT NULL,
	"quiet_hours" boolean DEFAULT true NOT NULL,
	"status" "journey_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"live_since" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referee_id" uuid NOT NULL,
	"code" text NOT NULL,
	"via" text NOT NULL,
	"status" "referral_status" DEFAULT 'pending' NOT NULL,
	"rewarded_at" timestamp with time zone,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"percent" integer,
	"amount_cents" integer,
	"note" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "marketing_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "marketing_push" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "marketing_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "unsubscribe_token" text DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "acquisition" "acquisition_channel" DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "attribution" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "kind" "order_kind" DEFAULT 'package' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gift_card_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "subtotal_cents" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "credit_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "voucher_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "gift_cards_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "gift_card_amounts" integer[] DEFAULT '{5000,10000,20000}'::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "gift_card_custom_min_cents" integer;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "gift_card_custom_max_cents" integer;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "gift_card_validity_days" integer DEFAULT 365 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "gift_card_give_within_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "referrals_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "referral_qualify" text DEFAULT 'classes_attended' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "referral_qualify_value" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "referral_qualify_within_days" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "referrer_reward" jsonb DEFAULT '{"type":"free_classes","classes":1,"validDays":60}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "referee_reward" jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "referral_code_window_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "referral_monthly_cap" integer;--> statement-breakpoint
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_image_file_id_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_grant_id_credit_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."credit_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_email_id_email_designs_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."email_designs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_designs" ADD CONSTRAINT "email_designs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_designs" ADD CONSTRAINT "email_designs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_designs" ADD CONSTRAINT "gift_card_designs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_designs" ADD CONSTRAINT "gift_card_designs_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_design_id_gift_card_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."gift_card_designs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_segment_members" ADD CONSTRAINT "journey_segment_members_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_segment_members" ADD CONSTRAINT "journey_segment_members_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_step_log" ADD CONSTRAINT "journey_step_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_step_log" ADD CONSTRAINT "journey_step_log_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_step_log" ADD CONSTRAINT "journey_step_log_enrollment_id_journey_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."journey_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_step_log" ADD CONSTRAINT "journey_step_log_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_users_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_dismissals_uq" ON "announcement_dismissals" USING btree ("announcement_id","user_id");--> statement-breakpoint
CREATE INDEX "announcements_live_idx" ON "announcements" USING btree ("org_id","ends_at");--> statement-breakpoint
CREATE INDEX "credit_grants_client_idx" ON "credit_grants" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_client_idx" ON "credit_ledger" USING btree ("org_id","client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_code_uq" ON "gift_cards" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "gift_cards_buyer_idx" ON "gift_cards" USING btree ("org_id","buyer_id");--> statement-breakpoint
CREATE INDEX "gift_cards_recipient_idx" ON "gift_cards" USING btree ("org_id","recipient_id");--> statement-breakpoint
CREATE INDEX "journey_enrollments_due_idx" ON "journey_enrollments" USING btree ("next_run_at") WHERE "journey_enrollments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "journey_enrollments_client_idx" ON "journey_enrollments" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journey_one_active_per_client" ON "journey_enrollments" USING btree ("journey_id","client_id") WHERE "journey_enrollments"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "journey_segment_members_uq" ON "journey_segment_members" USING btree ("journey_id","client_id");--> statement-breakpoint
CREATE INDEX "journey_step_log_idx" ON "journey_step_log" USING btree ("journey_id","step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_one_per_referee" ON "referrals" USING btree ("org_id","referee_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("org_id","referrer_id");--> statement-breakpoint
CREATE INDEX "vouchers_client_idx" ON "vouchers" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_unsubscribe_uq" ON "memberships" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_referral_code_uq" ON "memberships" USING btree ("org_id","referral_code") WHERE "memberships"."referral_code" is not null;