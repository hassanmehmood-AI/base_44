ALTER TABLE "conversations" ADD COLUMN "customer_avatar_key" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "customer_avatar_pending_url" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "customer_avatar_capture_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "customer_avatar_capture_first_seen_at" timestamp with time zone;