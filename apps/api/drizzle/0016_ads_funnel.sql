CREATE TABLE "ad_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"event" text NOT NULL,
	"client_id" uuid,
	"lead_id" uuid,
	"value_cents" integer,
	"currency" text,
	"gclid" text,
	"fbclid" text,
	"meta_lead_id" text,
	"happened_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ads_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"meta_page_id" text,
	"meta_page_token" text,
	"meta_pixel_id" text,
	"meta_capi_token" text,
	"meta_send_conversions" boolean DEFAULT false NOT NULL,
	"meta_last_error" text,
	"google_key" text NOT NULL,
	"google_feed_key" text NOT NULL,
	"google_feed_enabled" boolean DEFAULT false NOT NULL,
	"google_signup_name" text DEFAULT 'Studio sign-up' NOT NULL,
	"google_purchase_name" text DEFAULT 'First purchase' NOT NULL,
	"phone_country_code" text DEFAULT '65' NOT NULL,
	"lead_follow_up" boolean DEFAULT false NOT NULL,
	"lead_first_email_id" uuid,
	"lead_reminder_email_id" uuid,
	"lead_reminder_days" integer DEFAULT 3 NOT NULL,
	"lead_notify_team" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text,
	"phone" text,
	"note" text,
	"external_id" text,
	"campaign_name" text,
	"ad_name" text,
	"form_name" text,
	"gclid" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"token" text NOT NULL,
	"client_id" uuid,
	"unsubscribed" boolean DEFAULT false NOT NULL,
	"next_follow_up_at" timestamp with time zone,
	"joined_at" timestamp with time zone,
	"bought_at" timestamp with time zone,
	"first_purchase_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "to_email" text;--> statement-breakpoint
ALTER TABLE "ad_conversions" ADD CONSTRAINT "ad_conversions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_conversions" ADD CONSTRAINT "ad_conversions_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_conversions" ADD CONSTRAINT "ad_conversions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_settings" ADD CONSTRAINT "ads_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_settings" ADD CONSTRAINT "ads_settings_lead_first_email_id_email_designs_id_fk" FOREIGN KEY ("lead_first_email_id") REFERENCES "public"."email_designs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads_settings" ADD CONSTRAINT "ads_settings_lead_reminder_email_id_email_designs_id_fk" FOREIGN KEY ("lead_reminder_email_id") REFERENCES "public"."email_designs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_conversions_pending_idx" ON "ad_conversions" USING btree ("status","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_conversions_once" ON "ad_conversions" USING btree ("org_id","platform","event","client_id");--> statement-breakpoint
CREATE INDEX "leads_org_idx" ON "leads" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_external_uq" ON "leads" USING btree ("org_id","source","external_id") WHERE "leads"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_token_uq" ON "leads" USING btree ("token");