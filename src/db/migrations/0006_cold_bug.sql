CREATE TABLE "campaign_round_robin_cursors" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"last_assigned_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manager_agent_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manager_user_id" uuid NOT NULL,
	"agent_user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_round_robin_cursors" ADD CONSTRAINT "campaign_round_robin_cursors_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_round_robin_cursors" ADD CONSTRAINT "campaign_round_robin_cursors_last_assigned_user_id_users_id_fk" FOREIGN KEY ("last_assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_agent_assignments" ADD CONSTRAINT "manager_agent_assignments_manager_user_id_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_agent_assignments" ADD CONSTRAINT "manager_agent_assignments_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_agent_assignments" ADD CONSTRAINT "manager_agent_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "manager_agent_company_idx" ON "manager_agent_assignments" USING btree ("agent_user_id","company_id");--> statement-breakpoint
CREATE INDEX "manager_agent_assignments_manager_idx" ON "manager_agent_assignments" USING btree ("manager_user_id");