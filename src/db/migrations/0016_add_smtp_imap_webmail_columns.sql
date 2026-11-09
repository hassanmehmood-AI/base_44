ALTER TABLE "company_email_accounts" ADD COLUMN "smtp_host" text;--> statement-breakpoint
ALTER TABLE "company_email_accounts" ADD COLUMN "smtp_port" integer;--> statement-breakpoint
ALTER TABLE "company_email_accounts" ADD COLUMN "smtp_security" text;--> statement-breakpoint
ALTER TABLE "company_email_accounts" ADD COLUMN "imap_host" text;--> statement-breakpoint
ALTER TABLE "company_email_accounts" ADD COLUMN "imap_port" integer;--> statement-breakpoint
ALTER TABLE "company_email_accounts" ADD COLUMN "imap_security" text;--> statement-breakpoint
ALTER TABLE "company_email_accounts" ADD COLUMN "smtp_imap_username" text;--> statement-breakpoint
ALTER TABLE "company_email_accounts" ADD COLUMN "encrypted_password" text;--> statement-breakpoint
ALTER TABLE "company_email_accounts" ADD COLUMN "imap_uid_validity" text;--> statement-breakpoint
ALTER TABLE "company_email_accounts" ADD COLUMN "imap_last_seen_uid" text;