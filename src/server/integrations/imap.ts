import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { SmtpSecurity } from "./smtp";

/** Generic IMAP wrapper — the inbound-reading counterpart to smtp.ts.
 * Scope deliberately limited to the INBOX folder only: unlike Gmail's own
 * SENT label (a reliable, built-in way to also capture messages sent
 * directly from Gmail's own UI), there is no universal way to find a
 * "Sent" folder across arbitrary webmail providers — folder naming isn't
 * standardized ("Sent", "Sent Items", "INBOX.Sent", ...), and while RFC
 * 6154's SPECIAL-USE extension solves this for providers that support it,
 * not all do. This is a real, documented V1 limitation: a message sent
 * from the connected mailbox's own native webmail app (not through this
 * CRM) will not appear here. Messages sent THROUGH the CRM (via
 * smtp.ts's sendSmtpMessage) are already recorded directly by the caller
 * at send time, same as every other channel in this app — this gap only
 * affects mail sent outside the CRM entirely. */

export type ImapConnectionConfig = {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
};

export class ImapConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImapConnectionError";
  }
}

export type ImapAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  content: Buffer;
};

export type ImapMessage = {
  uid: number;
  /** The Message-ID header — used for inbound/outbound de-duplication the
   * same way Gmail's message.id is, via messages.metadata.externalId. Can
   * be null for a small minority of malformed real-world messages; the
   * caller falls back to uid-based dedup in that case (uid is always
   * unique within one mailbox, which is all that's needed here). */
  messageId: string | null;
  internalDate: Date;
  from: { name: string | null; email: string | null };
  to: { name: string | null; email: string | null };
  subject: string | null;
  body: string;
  /** Raw, UNSANITIZED html — same contract as google.ts's GmailMessage.
   * bodyHtml: callers must run this through lib/emailHtml.ts's
   * sanitizeEmailHtml before storing or rendering it. */
  bodyHtml: string | null;
  attachments: ImapAttachment[];
};

function transportOptionsFor(config: ImapConnectionConfig) {
  // IMAP's own convention differs slightly from SMTP's: "SSL/TLS" is
  // implicit-from-connect (almost always port 993) same idea as SMTP's
  // secure:true; STARTTLS starts plain and upgrades (almost always port
  // 143) — imapflow's own `secure` option covers the implicit-TLS case,
  // and `secure: false` lets the server offer STARTTLS, which imapflow
  // uses automatically when available. NONE (plain, unencrypted) only for
  // completeness, same as smtp.ts.
  return {
    host: config.host,
    port: config.port,
    secure: config.security === "SSL",
    auth: { user: config.username, pass: config.password },
    logger: false as const,
  };
}

/** A real login + mailbox-open attempt — the IMAP half of the "test
 * connection" step (smtp.ts's testSmtpConnection is the other half; the
 * onboarding flow runs both before ever saving credentials). Never throws
 * for a connection/auth failure — returns a plain result, same convention
 * as testSmtpConnection. */
export async function testImapConnection(config: ImapConnectionConfig): Promise<{ ok: true } | { ok: false; message: string }> {
  const client = new ImapFlow(transportOptionsFor(config));
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not connect to the IMAP server." };
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Opens INBOX and returns its current UIDVALIDITY — the IMAP equivalent
 * of google.ts's establishHistoryBaseline. imapSync.ts calls this once
 * when a mailbox has no cursor yet, or when the stored UIDVALIDITY no
 * longer matches the server's current one (meaning every previously-seen
 * UID is no longer a valid reference — RFC 3501 §2.3.1.1 — so sync must
 * restart from "only new mail from here on", same "never backfill"
 * guarantee the Gmail path gives). */
export async function getMailboxUidValidity(config: ImapConnectionConfig): Promise<{ uidValidity: string; lastUid: string }> {
  const client = new ImapFlow(transportOptionsFor(config));
  try {
    await client.connect();
    const box = await client.mailboxOpen("INBOX");
    return { uidValidity: String(box.uidValidity), lastUid: String(box.uidNext - 1) };
  } catch (e) {
    throw new ImapConnectionError(e instanceof Error ? e.message : "Failed to open INBOX.");
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Fetches every message in INBOX with a UID greater than afterUid —
 * imapSync.ts's main sync loop. Each message is parsed via mailparser
 * (mirrors google.ts's extractBody/extractAttachments, but IMAP + RFC822
 * gives the full message, attachments included, in one fetch — no
 * separate "list metadata, then fetch bytes" two-step like Gmail's
 * attachmentId/getAttachment pattern). Returns messages oldest-first, same
 * ordering convention as google.ts's listHistory. */
export async function fetchNewMessages(config: ImapConnectionConfig, afterUid: number): Promise<ImapMessage[]> {
  const client = new ImapFlow(transportOptionsFor(config));
  const messages: ImapMessage[] = [];
  try {
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });

    const range = `${afterUid + 1}:*`;
    for await (const message of client.fetch(range, { uid: true, envelope: true, internalDate: true, source: true })) {
      // imapflow's range fetch can include the boundary UID itself even
      // when there's nothing actually newer — guard explicitly rather than
      // relying on range-string semantics alone.
      if (message.uid <= afterUid || !message.source) continue;

      const parsed = await simpleParser(message.source);
      const fromAddr = parsed.from?.value?.[0];
      const toAddr = Array.isArray(parsed.to) ? parsed.to[0]?.value?.[0] : parsed.to?.value?.[0];

      messages.push({
        uid: message.uid,
        messageId: parsed.messageId ?? null,
        internalDate: message.internalDate ? new Date(message.internalDate) : new Date(),
        from: { name: fromAddr?.name || null, email: fromAddr?.address || null },
        to: { name: toAddr?.name || null, email: toAddr?.address || null },
        subject: parsed.subject || null,
        body: parsed.text || (parsed.html ? stripHtml(parsed.html) : ""),
        bodyHtml: parsed.html || null,
        attachments: parsed.attachments.map((a) => ({
          filename: a.filename || "attachment",
          mimeType: a.contentType,
          size: a.size,
          content: a.content,
        })),
      });
    }
    return messages;
  } catch (e) {
    throw new ImapConnectionError(e instanceof Error ? e.message : "Failed to fetch messages from INBOX.");
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Same best-effort plain-text fallback as google.ts's own HTML-to-text
 * conversion — used only when a message has HTML but no real text/plain
 * part (mailparser already provides parsed.text directly in the normal
 * case, so this is the uncommon-path fallback only). */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
