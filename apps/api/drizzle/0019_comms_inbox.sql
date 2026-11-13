CREATE TABLE "comms_billing" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'none' NOT NULL,
	"meta_payment_confirmed_at" timestamp with time zone,
	"meta_payment_confirmed_by" uuid,
	"balance_cents" numeric(12, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"origin" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text,
	"template" jsonb,
	"external_id" text,
	"status" text NOT NULL,
	"error" text,
	"sent_by" uuid,
	"cost_cents" numeric(10, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"contact" text NOT NULL,
	"contact_name" text,
	"client_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"unread" integer DEFAULT 0 NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"last_preview" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_credit_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text,
	"provider_ref" text,
	"created_by" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"change_cents" numeric(12, 2) NOT NULL,
	"balance_after_cents" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"message_id" uuid,
	"purchase_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "allow_booking_without_package" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_settings" ADD COLUMN "coexistence" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_settings" ADD COLUMN "connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comms_billing" ADD CONSTRAINT "comms_billing_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_billing" ADD CONSTRAINT "comms_billing_meta_payment_confirmed_by_users_id_fk" FOREIGN KEY ("meta_payment_confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_messages" ADD CONSTRAINT "comms_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_messages" ADD CONSTRAINT "comms_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_messages" ADD CONSTRAINT "comms_messages_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_credit_purchases" ADD CONSTRAINT "message_credit_purchases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_credit_purchases" ADD CONSTRAINT "message_credit_purchases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_credit_ledger" ADD CONSTRAINT "message_credit_ledger_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_credit_ledger" ADD CONSTRAINT "message_credit_ledger_message_id_comms_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."comms_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comms_messages_conv_idx" ON "comms_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "comms_messages_external_uq" ON "comms_messages" USING btree ("org_id","external_id") WHERE "comms_messages"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_contact_uq" ON "conversations" USING btree ("org_id","channel","contact");--> statement-breakpoint
CREATE INDEX "conversations_recent_idx" ON "conversations" USING btree ("org_id","last_message_at");