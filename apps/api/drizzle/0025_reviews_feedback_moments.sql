CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"category" text NOT NULL,
	"location_id" uuid,
	"message" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"feedback_id" uuid NOT NULL,
	"author_id" uuid,
	"from_studio" boolean NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL,
	"story" jsonb,
	"seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"instructor_id" uuid,
	"class_type_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"google_offered_at" timestamp with time zone,
	"google_clicked_at" timestamp with time zone,
	"handled_at" timestamp with time zone,
	"handled_by" uuid,
	"staff_reply" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_range" CHECK ("reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "review_skipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "review_snooze_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "celebrations_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "reviews_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "google_review_url" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "celebrations_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "ai_recaps" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_class_type_id_class_types_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."class_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_org_idx" ON "feedback" USING btree ("org_id","category","status");--> statement-breakpoint
CREATE INDEX "feedback_replies_idx" ON "feedback_replies" USING btree ("feedback_id");--> statement-breakpoint
CREATE UNIQUE INDEX "moments_user_key_uq" ON "moments" USING btree ("org_id","user_id","key");--> statement-breakpoint
CREATE INDEX "moments_user_idx" ON "moments" USING btree ("user_id","seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_booking_uq" ON "reviews" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "reviews_org_created_idx" ON "reviews" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_instructor_idx" ON "reviews" USING btree ("instructor_id");