CREATE TABLE "zadarma_extensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sip_extension" text,
	"sip_password_encrypted" text,
	"caller_id_number" text,
	"company_id" uuid,
	"user_id" uuid,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_by" uuid,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zadarma_extensions" ADD CONSTRAINT "zadarma_extensions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zadarma_extensions" ADD CONSTRAINT "zadarma_extensions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zadarma_extensions" ADD CONSTRAINT "zadarma_extensions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zadarma_extensions_company_idx" ON "zadarma_extensions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "zadarma_extensions_user_idx" ON "zadarma_extensions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zadarma_extensions_sip_idx" ON "zadarma_extensions" USING btree ("sip_extension");--> statement-breakpoint
CREATE UNIQUE INDEX "zadarma_extensions_user_pending_active_idx" ON "zadarma_extensions" USING btree ("user_id") WHERE "zadarma_extensions"."status" in ('PENDING', 'ACTIVE');