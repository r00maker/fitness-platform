ALTER TABLE "email_campaigns" DROP CONSTRAINT "email_campaigns_email_id_email_designs_id_fk";
--> statement-breakpoint
ALTER TABLE "email_campaigns" ALTER COLUMN "email_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD COLUMN "email_name" text;--> statement-breakpoint
ALTER TABLE "email_designs" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "journeys" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_email_id_email_designs_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."email_designs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "email_campaigns" SET "email_name" = (SELECT "name" FROM "email_designs" WHERE "email_designs"."id" = "email_campaigns"."email_id") WHERE "email_name" IS NULL;
