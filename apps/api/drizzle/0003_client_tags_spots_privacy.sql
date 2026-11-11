CREATE TYPE "public"."member_source" AS ENUM('direct', 'classpass');--> statement-breakpoint
CREATE TABLE "client_tag_assignments" (
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "spot" integer;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "source" "member_source" DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "show_in_attendee_list" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "spot_labels" text[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "client_tag_assignments" ADD CONSTRAINT "client_tag_assignments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_tag_assignments" ADD CONSTRAINT "client_tag_assignments_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_tag_assignments" ADD CONSTRAINT "client_tag_assignments_tag_id_client_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."client_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_tags" ADD CONSTRAINT "client_tags_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_tag_assignment_uq" ON "client_tag_assignments" USING btree ("client_id","tag_id");--> statement-breakpoint
CREATE INDEX "client_tag_assignment_org_idx" ON "client_tag_assignments" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_tags_name_uq" ON "client_tags" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_client_per_spot" ON "bookings" USING btree ("session_id","spot") WHERE "bookings"."status" = 'confirmed' and "bookings"."spot" is not null;