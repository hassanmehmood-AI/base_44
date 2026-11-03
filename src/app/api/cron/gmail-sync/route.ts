import { NextRequest, NextResponse } from "next/server";
import * as gmailSyncService from "@/server/services/gmailSync";

/** Gmail sync safety net + watch renewal — proactively syncs every ACTIVE
 * connected mailbox and renews any watch nearing expiry (see
 * gmailSync.ts's syncAllActiveAccounts). This is what makes the system
 * resilient to a Pub/Sub push that's silently dropped (network blip, a
 * deploy in progress when Google tried to deliver it) and to a watch
 * expiring on a mailbox nobody reconnected — api/webhooks/gmail/route.ts's
 * own per-notification sync is the fast path, this is the backstop, same
 * role as api/cron/whapi-process-pending plays for WhatsApp.
 *
 * Same auth model as that route: a shared CRON_SECRET bearer check, since
 * nothing here is tied to a logged-in user and an external scheduler (same
 * Railway cron-trigger-service pattern) is expected to call this on an
 * interval — every ~15 minutes is frequent enough to catch a missed push
 * quickly without meaningfully adding to Gmail API usage. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await gmailSyncService.syncAllActiveAccounts();
  return NextResponse.json(result);
}
