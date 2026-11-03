CREATE TABLE "company_email_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"email_address" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"encrypted_refresh_token" text,
	"encrypted_access_token" text,
	"access_token_expires_at" timestamp with time zone,
	"granted_scopes" text,
	"history_id" text,
	"watch_expiration" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "company_email_account_id" uuid;--> statement-breakpoint
ALTER TABLE "company_email_accounts" ADD CONSTRAINT "company_email_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_email_accounts_active_address_idx" ON "company_email_accounts" USING btree (lower("email_address")) WHERE "company_email_accounts"."status" <> 'DISCONNECTED';--> statement-breakpoint
CREATE INDEX "company_email_accounts_company_id_idx" ON "company_email_accounts" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_company_email_account_id_company_email_accounts_id_fk" FOREIGN KEY ("company_email_account_id") REFERENCES "public"."company_email_accounts"("id") ON DELETE set null ON UPDATE no action;