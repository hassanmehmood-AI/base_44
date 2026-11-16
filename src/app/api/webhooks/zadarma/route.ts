import { NextRequest, NextResponse, after } from "next/server";
import * as zadarmaCallEvents from "@/server/services/zadarmaCallEvents";

/** Inbound Zadarma PBX call-status notifications (NOTIFY_START/
 * NOTIFY_INTERNAL/NOTIFY_ANSWER/NOTIFY_END/NOTIFY_OUT_START/NOTIFY_OUT_END/
 * NOTIFY_RECORD) — one shared URL for the single central Zadarma account,
 * same durable-stage-then-process-via-after() shape as
 * api/webhooks/whapi/route.ts.
 *
 * NOT YET REGISTERED on the live Zadarma account (that's a one-time
 * POST /v1/pbx/callinfo/notifications/ call or dashboard step, deliberately
 * not done as part of this phase) — this route exists and is fully
 * reachable, but nothing will actually invoke it until that subscription
 * step happens, which needs its own separate approval.
 *
 * Authentication: Zadarma signs each notification with a `Signature`
 * header (HMAC-SHA1 of a per-event-type string, base64-of-hex — see
 * zadarma.ts's verifyWebhookSignature). A request with a missing/wrong
 * signature, or an unrecognized event type, is rejected the same way (401)
 * either way — never revealing which reason applied. There is no per-
 * company secret here (unlike Whapi's per-channel header): Zadarma signs
 * with the single account-wide API secret, since this is one shared
 * account's own PBX, not a multi-tenant provider. */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const fields = parseBody(rawBody, request.headers.get("content-type"));

  const eventType = fields.event;
  if (!eventType) {
    return new NextResponse("Missing event type", { status: 400 });
  }

  const signature = request.headers.get("signature");
  if (!zadarmaCallEvents.verifySignature(eventType, fields, signature)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    await zadarmaCallEvents.stageEvent(eventType, fields);
  } catch (e) {
    console.error("[zadarma webhook] failed to stage inbound event:", e);
    return new NextResponse("Internal error", { status: 500 });
  }

  after(async () => {
    try {
      await zadarmaCallEvents.processPendingCallEvents();
    } catch (e) {
      console.error("[zadarma webhook] processPendingCallEvents failed:", e);
    }
  });

  return new NextResponse("OK", { status: 200 });
}

/** Zadarma's documented notification delivery is a standard form POST
 * (confirmed against their official PHP SDK's own `$_POST` usage) — parsed
 * as application/x-www-form-urlencoded first; JSON is accepted as a
 * fallback in case a given event type is ever delivered differently.
 * Never throws — an unparseable body just yields an empty field set, which
 * fails signature verification cleanly rather than crashing. */
function parseBody(raw: string, contentType: string | null): Record<string, string | undefined> {
  if (contentType?.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, string | undefined>;
    } catch {
      // fall through to form-encoded parsing below
    }
  }
  const fields: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw)) {
    fields[key] = value;
  }
  return fields;
}
