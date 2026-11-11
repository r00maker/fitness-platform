CREATE TYPE "public"."fee_status" AS ENUM('pending', 'waived', 'charged');--> statement-breakpoint
CREATE TYPE "public"."fee_type" AS ENUM('late_cancel', 'no_show');--> statement-breakpoint
CREATE TABLE "fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"type" "fee_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "fee_status" DEFAULT 'pending' NOT NULL,
	"waived_by" uuid,
	"waived_at" timestamp with time zone,
	"waived_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "booking_opens_days_before" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "booking_closes_minutes_before" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "weekly_booking_limit" integer;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "currency" text DEFAULT 'SGD' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "late_cancel_fee_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "late_cancel_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "no_show_fee_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "no_show_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fees" ADD CONSTRAINT "fees_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees" ADD CONSTRAINT "fees_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees" ADD CONSTRAINT "fees_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fees" ADD CONSTRAINT "fees_waived_by_users_id_fk" FOREIGN KEY ("waived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fees_one_active_per_booking" ON "fees" USING btree ("booking_id","type") WHERE "fees"."status" <> 'waived';--> statement-breakpoint
CREATE INDEX "fees_client_idx" ON "fees" USING btree ("client_id");