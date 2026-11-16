CREATE TABLE "zadarma_call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"pbx_call_id" text,
	"raw_payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "pbx_call_id" text;--> statement-breakpoint
CREATE INDEX "zadarma_call_events_status_idx" ON "zadarma_call_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "zadarma_call_events_pbx_call_id_idx" ON "zadarma_call_events" USING btree ("pbx_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_pbx_call_id_idx" ON "calls" USING btree ("pbx_call_id");