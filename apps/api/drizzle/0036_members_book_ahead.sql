ALTER TABLE "bookings" ADD COLUMN "held_for_period" integer;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "members_book_ahead" boolean DEFAULT true NOT NULL;