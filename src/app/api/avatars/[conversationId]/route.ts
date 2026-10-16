import { NextRequest, NextResponse } from "next/server";
import * as conversationsRepo from "@/server/repositories/conversations";
import * as avatarStorage from "@/server/integrations/avatarStorage";
import { assertCompanyAccess, UnauthorizedError } from "@/server/services/authorization";

/** Authenticated avatar-serving route — the only path to a stored customer
 * avatar's bytes (see services/avatarCapture.ts). Never a public bucket URL:
 * every request goes through the same session + company-access check used
 * everywhere else in this app. Returns 404 for a missing/not-yet-captured
 * avatar rather than an error — the frontend's <img> onError already falls
 * back to initials for exactly this case (see components/ui/Avatar.tsx and
 * RedesSocialesClient's fallback-to-customerAvatarUrl chain), so no special
 * handling is needed on the frontend for this route specifically. */
export async function GET(_request: NextRequest, context: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await context.params;

  const conversation = await conversationsRepo.findById(conversationId);
  if (!conversation) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    await assertCompanyAccess(conversation.companyId);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }
    throw e;
  }

  if (!conversation.customerAvatarKey) {
    return NextResponse.json({ error: "No avatar stored for this conversation." }, { status: 404 });
  }

  let avatar: { bytes: Uint8Array; contentType: string } | null;
  try {
    avatar = await avatarStorage.getAvatar(conversation.customerAvatarKey);
  } catch (e) {
    console.error("[avatars] storage read failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Avatar temporarily unavailable." }, { status: 502 });
  }

  if (!avatar) {
    return NextResponse.json({ error: "No avatar stored for this conversation." }, { status: 404 });
  }

  // Copied into a plain ArrayBuffer (not just Uint8Array<ArrayBufferLike>,
  // which TS's BodyInit won't accept) — the bytes already came from the
  // storage SDK's own buffer, so this is just satisfying the Response body
  // type, not a meaningful extra allocation for an avatar-sized payload.
  const body = new ArrayBuffer(avatar.bytes.byteLength);
  new Uint8Array(body).set(avatar.bytes);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": avatar.contentType,
      // Private, authenticated content — never cached by a shared/public
      // cache; the requesting browser may still cache it for that one user.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
