ALTER TYPE "public"."notification_channel" ADD VALUE 'whatsapp';--> statement-breakpoint
CREATE TABLE "staff_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "role" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"phone_number_id" text,
	"business_account_id" text,
	"access_token" text,
	"display_phone" text,
	"default_country_code" text DEFAULT '65' NOT NULL,
	"templates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_series" ADD COLUMN "auto_cancel_hours" integer;--> statement-breakpoint
ALTER TABLE "class_series" ADD COLUMN "auto_cancel_min" integer;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD COLUMN "auto_cancel_hours" integer;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD COLUMN "auto_cancel_min" integer;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD COLUMN "auto_cancel_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD COLUMN "auto_cancelled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "class_templates" ADD COLUMN "auto_cancel_hours" integer;--> statement-breakpoint
ALTER TABLE "class_templates" ADD COLUMN "auto_cancel_min" integer;--> statement-breakpoint
ALTER TABLE "journey_enrollments" ADD COLUMN "converted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "marketing_whatsapp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_settings" ADD CONSTRAINT "whatsapp_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invites_token_uq" ON "staff_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "staff_invites_org_idx" ON "staff_invites" USING btree ("org_id","user_id");--> statement-breakpoint
-- ClassPass clients are leads: add the ones who already exist.
INSERT INTO "leads" ("org_id", "source", "status", "first_name", "last_name", "email", "phone", "note", "token", "client_id", "joined_at")
SELECT m."org_id", 'classpass', 'new', u."first_name", u."last_name", lower(u."email"), u."phone",
  'Books through ClassPass. Becomes a member when they buy one of your packages.', md5(random()::text || clock_timestamp()::text), u."id", m."created_at"
FROM "memberships" m JOIN "users" u ON u."id" = m."user_id"
WHERE m."source" = 'classpass' AND m."role" = 'client'
  AND NOT EXISTS (SELECT 1 FROM "leads" l WHERE l."org_id" = m."org_id" AND l."client_id" = u."id" AND l."source" = 'classpass');
