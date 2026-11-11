CREATE TYPE "public"."health_category" AS ENUM('injury', 'pregnancy', 'postnatal', 'recent_surgery', 'medical_condition', 'other');--> statement-breakpoint
CREATE TYPE "public"."health_note_status" AS ENUM('active', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."waiver_method" AS ENUM('signed_by_client', 'confirmed_by_staff');--> statement-breakpoint
CREATE TABLE "client_health_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"category" "health_category" NOT NULL,
	"description" text NOT NULL,
	"status" "health_note_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_waivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"method" "waiver_method" NOT NULL,
	"signed_name" text,
	"waiver_version" integer,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text
);
--> statement-breakpoint
ALTER TABLE "client_tags" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "waiver_required" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "waiver_text" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "waiver_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "spot_booking_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "client_health_notes" ADD CONSTRAINT "client_health_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_health_notes" ADD CONSTRAINT "client_health_notes_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_health_notes" ADD CONSTRAINT "client_health_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_health_notes" ADD CONSTRAINT "client_health_notes_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_waivers" ADD CONSTRAINT "client_waivers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_waivers" ADD CONSTRAINT "client_waivers_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_waivers" ADD CONSTRAINT "client_waivers_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_waivers" ADD CONSTRAINT "client_waivers_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_notes_client_idx" ON "client_health_notes" USING btree ("org_id","client_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "client_waivers_one_active" ON "client_waivers" USING btree ("org_id","client_id") WHERE "client_waivers"."revoked_at" is null;