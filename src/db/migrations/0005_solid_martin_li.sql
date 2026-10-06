CREATE TABLE "company_round_robin_cursors" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"last_assigned_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_round_robin_cursors" ADD CONSTRAINT "company_round_robin_cursors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_round_robin_cursors" ADD CONSTRAINT "company_round_robin_cursors_last_assigned_user_id_users_id_fk" FOREIGN KEY ("last_assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;