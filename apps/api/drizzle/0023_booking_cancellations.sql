ALTER TABLE "bookings" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancelled_via" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;