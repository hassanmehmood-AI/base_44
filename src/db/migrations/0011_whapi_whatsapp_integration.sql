CREATE TABLE "whapi_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"channel_id" text,
	"api_url" text,
	"encrypted_token" text,
	"encrypted_webhook_secret" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whapi_inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"whapi_channel_id" uuid NOT NULL,
	"external_message_id" text NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "whapi_channel_id" uuid;--> statement-breakpoint
ALTER TABLE "whapi_channels" ADD CONSTRAINT "whapi_channels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whapi_inbound_events" ADD CONSTRAINT "whapi_inbound_events_whapi_channel_id_whapi_channels_id_fk" FOREIGN KEY ("whapi_channel_id") REFERENCES "public"."whapi_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whapi_channels_company_id_idx" ON "whapi_channels" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whapi_channels_channel_id_idx" ON "whapi_channels" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whapi_inbound_events_channel_message_idx" ON "whapi_inbound_events" USING btree ("whapi_channel_id","external_message_id");--> statement-breakpoint
CREATE INDEX "whapi_inbound_events_status_idx" ON "whapi_inbound_events" USING btree ("status");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_whapi_channel_id_whapi_channels_id_fk" FOREIGN KEY ("whapi_channel_id") REFERENCES "public"."whapi_channels"("id") ON DELETE set null ON UPDATE no action;