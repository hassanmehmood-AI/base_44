import { NextRequest, NextResponse } from "next/server";
import * as metaProvider from "@/server/integrations/meta";
import * as socialService from "@/server/services/social";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";

/** Meta's one-time webhook verification handshake, run when you register
 * this URL in the Developer App dashboard. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  try {
    const echoed = metaProvider.verifyWebhookChallenge(mode, token, challenge);
    if (echoed) return new NextResponse(echoed, { status: 200 });
    return new NextResponse("Verification failed", { status: 403 });
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) return new NextResponse(e.message, { status: 503 });
    throw e;
  }
}

/** Inbound Messenger/Instagram events. Meta expects a fast 200 ack and
 * retries on anything else, so processing errors are logged and still ack'd
 * — only a bad/missing signature is rejected outright. */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  let signatureValid: boolean;
  try {
    signatureValid = metaProvider.verifyWebhookSignature(rawBody, signature);
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) return new NextResponse(e.message, { status: 503 });
    throw e;
  }
  if (!signatureValid) return new NextResponse("Invalid signature", { status: 403 });

  let payload: {
    entry?: Array<{
      id: string;
      messaging?: Array<{ sender: { id: string }; message?: { text?: string } }>;
    }>;
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      if (!event.message?.text) continue;
      try {
        await socialService.ingestInboundMessage({
          platform: "META_PAGE",
          pageId: entry.id,
          senderId: event.sender.id,
          senderHandle: null,
          text: event.message.text,
        });
      } catch (err) {
        console.error("[meta webhook] failed to ingest message:", err);
      }
    }
  }

  return new NextResponse("OK", { status: 200 });
}
