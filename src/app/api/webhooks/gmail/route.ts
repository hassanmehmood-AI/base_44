import { NextRequest, NextResponse, after } from "next/server";
import * as companyEmailAccountsRepo from "@/server/repositories/companyEmailAccounts";
import * as gmailSyncService from "@/server/services/gmailSync";

/** Inbound Gmail activity via Google Cloud Pub/Sub push notifications — one
 * shared URL for every connected mailbox across every company (the
 * notification payload carries the mailbox's own address, which resolves
 * the company via companyEmailAccountsRepo.findByEmailAddress, same shape
 * as api/webhooks/whapi's channel_id resolution).
 *
 * Payload shape (Pub/Sub's own push format, not Gmail-specific):
 *   { message: { data: "<base64 JSON {emailAddress, historyId}>", ... },
 *     subscription: "projects/.../subscriptions/..." }
 *
 * Authentication — two independent layers, both required:
 *  1. (Primary) Google Cloud Pub/Sub's authenticated push: every push
 *     request carries an `Authorization: Bearer <OIDC token>` signed by a
 *     service account configured on the subscription, with an audience we
 *     choose. Verified via gmailSyncService.verifyPubSubOidcToken — checks
 *     signature (against Google's own published JWKS), issuer, audience,
 *     the specific service account identity, and expiration. This is what
 *     actually proves "Google sent this," not just "someone who knows a
 *     secret sent this."
 *  2. (Defense in depth) A shared-secret query param (?token=...), also
 *     configured as part of the subscription's own endpoint URL — mirrors
 *     Whapi's custom-header-secret convention (see integrations/whapi.ts's
 *     WEBHOOK_SECRET_HEADER_NAME doc comment). Costs nothing extra and
 *     narrows the blast radius if the OIDC audience/service-account config
 *     is ever accidentally loosened.
 *
 * Durability: historyId itself is the durable position (see gmailSync.ts's
 * module doc comment) — unlike Whapi, no staging table is needed here; a
 * failure mid-processing just means the next notification (or Pub/Sub's own
 * at-least-once redelivery of this one) resumes from the same stored
 * historyId and reprocesses safely. Still dispatched via after() so Pub/Sub
 * gets its 200 quickly and never treats a slow sync as a delivery failure
 * to retry. */
export async function POST(request: NextRequest) {
  const expectedSecret = process.env.GOOGLE_PUBSUB_WEBHOOK_SECRET;
  const audience = process.env.GOOGLE_PUBSUB_AUDIENCE;
  const serviceAccountEmail = process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL;
  if (!expectedSecret || !audience || !serviceAccountEmail) {
    console.error(
      "[gmail webhook] GOOGLE_PUBSUB_WEBHOOK_SECRET / GOOGLE_PUBSUB_AUDIENCE / GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL is not configured — rejecting all pushes."
    );
    return new NextResponse("Not configured", { status: 503 });
  }

  const providedSecret = request.nextUrl.searchParams.get("token");
  if (!gmailSyncService.verifyWebhookSecret(expectedSecret, providedSecret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const authorized = await gmailSyncService.verifyPubSubOidcToken(request.headers.get("authorization"), {
    audience,
    serviceAccountEmail,
  });
  if (!authorized) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let body: { message?: { data?: string } };
  try {
    body = await request.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const encodedData = body.message?.data;
  if (!encodedData) return new NextResponse("OK", { status: 200 }); // e.g. a Pub/Sub verification ping

  let notification: { emailAddress?: string; historyId?: string | number };
  try {
    notification = JSON.parse(Buffer.from(encodedData, "base64").toString("utf8"));
  } catch {
    return new NextResponse("Invalid notification payload", { status: 400 });
  }
  if (!notification.emailAddress) return new NextResponse("OK", { status: 200 });

  const account = await companyEmailAccountsRepo.findByEmailAddress(notification.emailAddress);
  if (!account) {
    // Not an error: a mailbox disconnected after its watch was registered
    // but before Google honored stopWatch keeps notifying for a little
    // while — Pub/Sub must still get a 200 so it stops redelivering.
    return new NextResponse("OK", { status: 200 });
  }

  after(async () => {
    try {
      await gmailSyncService.processHistoryForAccount(account);
    } catch (e) {
      console.error(`[gmail webhook] sync failed for account ${account.id}:`, e instanceof Error ? e.message : e);
    }
  });

  return new NextResponse("OK", { status: 200 });
}
