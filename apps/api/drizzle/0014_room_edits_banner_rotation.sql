ALTER TABLE "organizations" ADD COLUMN "banner_rotate_seconds" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "spot_columns" integer;