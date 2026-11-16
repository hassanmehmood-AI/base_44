CREATE TABLE "zadarma_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text,
	"direction_id" text NOT NULL,
	"country_code" text NOT NULL,
	"company_id" uuid,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"documents_group_id" text,
	"monthly_fee" text,
	"connect_fee" text,
	"currency" text,
	"purchased_by" uuid,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zadarma_numbers" ADD CONSTRAINT "zadarma_numbers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zadarma_numbers" ADD CONSTRAINT "zadarma_numbers_purchased_by_users_id_fk" FOREIGN KEY ("purchased_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zadarma_numbers_company_idx" ON "zadarma_numbers" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zadarma_numbers_number_idx" ON "zadarma_numbers" USING btree ("number");