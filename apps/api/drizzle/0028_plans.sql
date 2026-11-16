ALTER TABLE "organizations" ADD COLUMN "plan" text DEFAULT 'signature' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "branded_app" boolean DEFAULT false NOT NULL;