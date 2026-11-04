import { NextRequest, NextResponse } from "next/server";
import * as messagesRepo from "@/server/repositories/messages";
import * as conversationsRepo from "@/server/repositories/conversations";
import * as attachmentStorage from "@/server/integrations/emailAttachmentStorage";
import type { StoredEmailAttachment } from "@/lib/emailAttachments";
import { assertCompanyAccess, UnauthorizedError } from "@/server/services/authorization";

/** Authenticated email-attachment-serving route — the ONLY path to a
 * stored attachment's bytes, mirroring api/avatars/[conversationId]/
 * route.ts exactly: every request resolves message -> conversation ->
 * company and runs the same assertCompanyAccess check used everywhere
 * else in this app before ever touching storage. Never a public bucket
 * URL — see emailAttachmentStorage.ts's private ACL.
 *
 * [index] (not filename) identifies which attachment, avoiding any
 * filename-encoding/collision concerns entirely — the real filename is
 * still sent back in Content-Disposition for the browser's download
 * dialog, it's just not part of the URL's own identity. */
export async function GET(_request: NextRequest, context: { params: Promise<{ messageId: string; index: string }> }) {
  const { messageId, index } = await context.params;
  const attachmentIndex = Number(index);
  if (!Number.isInteger(attachmentIndex) || attachmentIndex < 0) {
    return NextResponse.json({ error: "Invalid attachment index." }, { status: 400 });
  }

  const message = await messagesRepo.findById(messageId);
  if (!message) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const conversation = await conversationsRepo.findById(message.conversationId);
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

  const attachments = (message.metadata as { attachments?: StoredEmailAttachment[] } | null)?.attachments ?? [];
  const attachment = attachments[attachmentIndex];
  if (!attachment) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  let stored: { bytes: Uint8Array; contentType: string } | null;
  try {
    stored = await attachmentStorage.getAttachment(attachment.key);
  } catch (e) {
    console.error("[email-attachments] storage read failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Attachment temporarily unavailable." }, { status: 502 });
  }

  if (!stored) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  const body = new ArrayBuffer(stored.bytes.byteLength);
  new Uint8Array(body).set(stored.bytes);

  // Images and PDFs can render safely inline (no script-execution surface
  // in either format); everything else (DOCX/XLSX) forces a download —
  // browsers have no safe native preview for those, and inline-rendering
  // an unknown/office document type risks a confusing or unsafe experience.
  const disposition = attachment.mimeType === "application/pdf" || attachment.mimeType.startsWith("image/") ? "inline" : "attachment";
  const safeFilename = attachment.filename.replace(/["\r\n]/g, "");

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `${disposition}; filename="${safeFilename}"`,
      // Prevents the browser from ever re-interpreting the declared
      // Content-Type based on sniffing the actual bytes — the one header
      // that matters most for a file whose content this app doesn't
      // itself validate beyond its declared type/size.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
