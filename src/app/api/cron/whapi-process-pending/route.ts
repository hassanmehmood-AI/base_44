import { NextRequest, NextResponse } from "next/server";
import * as whatsappService from "@/server/services/whatsapp";

/** Safety-net sweep for whapi_inbound_events left PENDING by a crash or a
 * failed after() dispatch in api/webhooks/whapi/route.ts — the webhook
 * route's own after() call already processes pending events on every
 * inbound message, so this only matters for an event that was staged but
 * never got processed (e.g. the process restarted between the staging
 * insert and the after() callback running). A new, independent route —
 * does not touch or share a schedule with api/cron/metricool-sync, which
 * stays exactly as it was.
 *
 * Same auth model as that route: a shared CRON_SECRET bearer check, since
 * nothing here is tied to a logged-in user and an external scheduler (same
 * Railway cron pattern as metricool-sync-trigger) is expected to call this
 * on an interval — e.g. every few minutes is more than enough, since this
 * is only mopping up rare failures, not the primary delivery path. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await whatsappService.processPendingWhapiEvents();
  return NextResponse.json(result);
}
