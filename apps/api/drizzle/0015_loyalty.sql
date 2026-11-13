ALTER TYPE "public"."credit_source" ADD VALUE 'loyalty';--> statement-breakpoint
CREATE TABLE "loyalty_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"change" integer NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"remaining" integer NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_remaining_ok" CHECK ("loyalty_lots"."remaining" >= 0 and "loyalty_lots"."remaining" <= "loyalty_lots"."amount")
);
--> statement-breakpoint
CREATE TABLE "loyalty_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"reward_id" uuid,
	"reward_name" text NOT NULL,
	"kind" text NOT NULL,
	"cost" integer NOT NULL,
	"status" text NOT NULL,
	"code" text,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"photo_file_id" uuid,
	"cost" integer NOT NULL,
	"kind" text NOT NULL,
	"reward" jsonb,
	"gift_card_cents" integer,
	"stock" integer,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "loyalty_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "loyalty_warned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "loyalty_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "loyalty_name" text DEFAULT 'Point' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "loyalty_name_plural" text DEFAULT 'Points' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "loyalty_earn" text DEFAULT 'classes' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "loyalty_points_per_class" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "loyalty_points_per_unit" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "loyalty_expiry" text DEFAULT 'inactivity' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "loyalty_expiry_months" integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "loyalty_include_classpass" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_lots" ADD CONSTRAINT "loyalty_lots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_lots" ADD CONSTRAINT "loyalty_lots_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_reward_id_loyalty_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."loyalty_rewards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_photo_file_id_files_id_fk" FOREIGN KEY ("photo_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loyalty_ledger_client_idx" ON "loyalty_ledger" USING btree ("org_id","client_id","created_at");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_ref_idx" ON "loyalty_ledger" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "loyalty_lots_client_idx" ON "loyalty_lots" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "loyalty_redemptions_idx" ON "loyalty_redemptions" USING btree ("org_id","status","created_at");