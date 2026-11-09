import nodemailer from "nodemailer";
import type { OutboundAttachment } from "./google";

/** Generic SMTP wrapper — unlike google.ts (one fixed provider, Google's
 * own API), this is deliberately provider-agnostic: every connection
 * detail (host/port/security/username/password) comes from the caller, per
 * company_email_accounts row, never hardcoded. This is what makes "any
 * webmail provider" actually true rather than a specific vendor
 * integration wearing a generic name. */

export type SmtpSecurity = "SSL" | "STARTTLS" | "NONE";

export type SmtpConnectionConfig = {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
};

export class SmtpConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpConnectionError";
  }
}

/** Maps this app's three-way security choice to nodemailer's actual
 * transport options. SSL/TLS is the "implicit TLS from the first byte"
 * mode (almost always port 465); STARTTLS starts the connection in plain
 * text and upgrades it (almost always port 587) — requireTLS: true makes
 * nodemailer refuse to send if the server doesn't actually support the
 * upgrade, rather than silently falling back to plain text. NONE exists
 * only for completeness (some self-hosted/test servers on port 25) — never
 * presented as the recommended choice in the UI. */
function transportOptionsFor(config: SmtpConnectionConfig) {
  const base = {
    host: config.host,
    port: config.port,
    auth: { user: config.username, pass: config.password },
  };
  if (config.security === "SSL") return { ...base, secure: true };
  if (config.security === "STARTTLS") return { ...base, secure: false, requireTLS: true };
  return { ...base, secure: false };
}

/** A real login attempt against the server — the "test connection" step
 * the onboarding flow runs before ever saving credentials, so a typo'd
 * host/port/password is caught immediately instead of surfacing as a
 * silent send failure later. Never throws for a connection/auth failure —
 * returns a plain result so the UI can show a clear, specific message;
 * only an unexpected internal error propagates. */
export async function testSmtpConnection(config: SmtpConnectionConfig): Promise<{ ok: true } | { ok: false; message: string }> {
  const transporter = nodemailer.createTransport(transportOptionsFor(config));
  try {
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not connect to the SMTP server." };
  } finally {
    transporter.close();
  }
}

/** Sends one message through the given connection — nodemailer builds the
 * full MIME structure (multipart/alternative for text+HTML, multipart/mixed
 * when attachments are present) internally, so unlike google.ts's
 * buildRawMessage this needs no manual MIME construction. bodyHtml must
 * already be sanitized by the caller (see lib/emailHtml.ts) — same division
 * of responsibility as every other send path in this app. Returns the
 * provider's own Message-ID when available, for parity with Gmail's
 * externalId (used for inbound/outbound de-duplication during IMAP sync). */
export async function sendSmtpMessage(
  config: SmtpConnectionConfig,
  input: {
    to: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string | null;
    attachments?: OutboundAttachment[];
  }
): Promise<{ externalId: string | null }> {
  const transporter = nodemailer.createTransport(transportOptionsFor(config));
  try {
    const info = await transporter.sendMail({
      from: config.username,
      to: input.to,
      subject: input.subject,
      text: input.bodyText,
      html: input.bodyHtml ?? undefined,
      attachments: (input.attachments ?? []).map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.bytes),
        contentType: a.mimeType,
      })),
    });
    return { externalId: info.messageId || null };
  } catch (e) {
    throw new SmtpConnectionError(e instanceof Error ? e.message : "Failed to send message via SMTP.");
  } finally {
    transporter.close();
  }
}
