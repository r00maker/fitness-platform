CREATE TABLE "client_celebrations" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_goals" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"month" text NOT NULL,
	"classes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_goals_range" CHECK ("client_goals"."classes" between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "app_theme" jsonb;--> statement-breakpoint
ALTER TABLE "client_celebrations" ADD CONSTRAINT "client_celebrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_celebrations" ADD CONSTRAINT "client_celebrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_goals" ADD CONSTRAINT "client_goals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_goals" ADD CONSTRAINT "client_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_celebrations_uq" ON "client_celebrations" USING btree ("org_id","user_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "client_goals_uq" ON "client_goals" USING btree ("org_id","user_id","month");