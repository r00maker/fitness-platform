CREATE TABLE "class_type_instructors" (
	"org_id" uuid NOT NULL,
	"class_type_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_sessions" ADD COLUMN "cover_for_instructor_id" uuid;--> statement-breakpoint
ALTER TABLE "class_type_instructors" ADD CONSTRAINT "class_type_instructors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_type_instructors" ADD CONSTRAINT "class_type_instructors_class_type_id_class_types_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."class_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_type_instructors" ADD CONSTRAINT "class_type_instructors_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "class_type_instructor_uq" ON "class_type_instructors" USING btree ("class_type_id","instructor_id");--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_cover_for_instructor_id_users_id_fk" FOREIGN KEY ("cover_for_instructor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;