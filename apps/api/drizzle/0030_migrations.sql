CREATE TABLE "client_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"first_visit_at" timestamp with time zone,
	"last_visit_at" timestamp with time zone,
	"member_since" timestamp with time zone,
	"notes" text,
	"emergency_contact" text,
	"date_of_birth" text,
	"source" text NOT NULL,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"format" text NOT NULL,
	"sheet" text,
	"kind" text NOT NULL,
	"kind_detected" text NOT NULL,
	"header_row" integer NOT NULL,
	"headers" text[] NOT NULL,
	"mapping" jsonb NOT NULL,
	"rows" jsonb,
	"row_count" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"status" text DEFAULT 'intake' NOT NULL,
	"source_platform" text,
	"intake" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"access_secret_enc" text,
	"access_delete_after" timestamp with time zone,
	"date_order" text,
	"last_check" jsonb,
	"checked_at" timestamp with time zone,
	"imported_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"file_id" uuid,
	"row_number" integer NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_history" ADD CONSTRAINT "client_history_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_history" ADD CONSTRAINT "client_history_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_history" ADD CONSTRAINT "client_history_job_id_migration_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."migration_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_files" ADD CONSTRAINT "migration_files_job_id_migration_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."migration_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_files" ADD CONSTRAINT "migration_files_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_files" ADD CONSTRAINT "migration_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_records" ADD CONSTRAINT "migration_records_job_id_migration_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."migration_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_records" ADD CONSTRAINT "migration_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_records" ADD CONSTRAINT "migration_records_file_id_migration_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."migration_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_history_org_client_uq" ON "client_history" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "migration_files_job_idx" ON "migration_files" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "migration_jobs_org_idx" ON "migration_jobs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "migration_records_job_idx" ON "migration_records" USING btree ("job_id","entity");