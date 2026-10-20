import { NextRequest, NextResponse, after } from "next/server";
import * as whatsappService from "@/server/services/whatsapp";
import * as avatarCapture from "@/server/services/avatarCapture";
import type { IncomingWhapiPayload } from "@/server/services/whatsapp";

/** Inbound WhatsApp events from Whapi.Cloud — one shared URL for every
 * company's channel (the payload's own `channel_id` field, confirmed
 * against Whapi's documented webhook format, is what resolves which
 * company this belongs to; see whatsappService.resolveAuthenticatedChannel).
 *
 * Authentication: Whapi's webhook delivery has NO native signature/HMAC
 * scheme (confirmed against their official webhook docs — unlike Meta's
 * X-Hub-Signature-256, there is nothing to verify against the raw body).
 * The compensating control, also confirmed against Whapi's own docs
 * ("Customizable Webhook Headers"), is a custom header we register
 * ourselves per channel at creation time (see whapiOnboarding.ts) and check
 * on every request here — WEBHOOK_SECRET_HEADER_NAME from integrations/whapi.ts.
 * A request with a missing/wrong header, or naming a channel_id that isn't a
 * known ACTIVE channel, is rejected the same way (401) either way — never
 * revealing which reason applied.
 *
 * Durability: unlike api/webhooks/meta (which processes inline and accepts
 * that a failure loses that one message, since Meta's own retry-on-non-200
 * plus accepted occasional loss was judged acceptable there), this route
 * does the bare minimum — authenticate, then durably stage each message in
 * whapi_inbound_events — before responding. Actually turning a staged event
 * into a conversation/message happens in processPendingWhapiEvents, kicked
 * off via after() so it doesn't delay this response, but able to recover a
 * never-launched or crashed attempt on the next trigger (this route's own
 * next call, or the dedicated sweep cron — see
 * api/cron/whapi-process-pending/route.ts) because the staging row already
 * exists in Postgres by the time this function returns 200. */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let payload: IncomingWhapiPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const providedSecret = request.headers.get("x-whapi-webhook-secret");
  const channel = await whatsappService.resolveAuthenticatedChannel(payload.channel_id, providedSecret);
  if (!channel) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    await whatsappService.stagePendingEvents(channel, payload);
  } catch (e) {
    // A failure HERE (before any durable insert succeeded) is the one case
    // this route can't make durable on its own — returning a non-200 at
    // least gives Whapi the chance to redeliver, if it retries on failure.
    console.error("[whapi webhook] failed to stage inbound events:", e);
    return new NextResponse("Internal error", { status: 500 });
  }

  after(async () => {
    try {
      await whatsappService.processPendingWhapiEvents();
    } catch (e) {
      console.error("[whapi webhook] processPendingWhapiEvents failed:", e);
    }
  });

  // Same after()-dispatched, best-effort pattern as api/cron/metricool-sync's
  // avatar-capture hook — processPendingAvatarCaptures is entirely generic
  // (not channel-specific), so this call picks up any WhatsApp avatar queued
  // by processPendingWhapiEvents above in the exact same tick, without this
  // response waiting on the actual download. A failure here can never affect
  // the 200 OK already being returned below.
  after(async () => {
    try {
      await avatarCapture.processPendingAvatarCaptures();
    } catch (e) {
      console.error("[whapi webhook] avatar capture failed:", e instanceof Error ? e.message : e);
    }
  });

  return new NextResponse("OK", { status: 200 });
}
