ALTER TYPE "public"."booking_payment" ADD VALUE 'classpass';--> statement-breakpoint
ALTER TYPE "public"."booking_source" ADD VALUE 'classpass';--> statement-breakpoint
ALTER TABLE "class_series" ADD COLUMN "classpass_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "class_series" ADD COLUMN "classpass_spots" integer;--> statement-breakpoint
ALTER TABLE "class_series" ADD COLUMN "client_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "class_series" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "class_series" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD COLUMN "classpass_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD COLUMN "classpass_spots" integer;--> statement-breakpoint
ALTER TABLE "class_templates" ADD COLUMN "classpass_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "class_templates" ADD COLUMN "classpass_spots" integer;--> statement-breakpoint
ALTER TABLE "class_types" ADD COLUMN "kind" text DEFAULT 'class' NOT NULL;--> statement-breakpoint
ALTER TABLE "class_series" ADD CONSTRAINT "class_series_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;