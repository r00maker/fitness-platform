CREATE TYPE "public"."theme" AS ENUM('system', 'light', 'dark');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "theme" "theme" DEFAULT 'system' NOT NULL;