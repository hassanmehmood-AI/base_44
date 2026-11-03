import { ProviderNotConfiguredError } from "./errors";

/** Google OAuth2 + Gmail API wrapper. Scopes requested are deliberately
 * minimal for this phase: gmail.send (outbound) and gmail.readonly
 * (inbound sync, built in a later phase via Gmail API push notifications —
 * see db/schema.ts's companyEmailAccounts comment on historyId/
 * watchExpiration) — never the full `https://mail.google.com/` scope,
 * which would trigger a stricter Google verification tier than this
 * integration actually needs. userinfo.email is included only to resolve
 * which address was actually connected (shown in the UI, stored as
 * company_email_accounts.email_address), not to read profile data. */

const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export class GoogleApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "GoogleApiError";
  }
}

function getOAuthConfig(): { clientId: string; clientSecret: string; authUrl: string; tokenUrl: string; redirectUri: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const authUrl = process.env.GOOGLE_AUTH_URL;
  const tokenUrl = process.env.GOOGLE_TOKEN_URL;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !authUrl || !tokenUrl || !redirectUri) {
    throw new ProviderNotConfiguredError(
      "Google OAuth",
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_AUTH_URL", "GOOGLE_TOKEN_URL", "GOOGLE_REDIRECT_URI"].filter(
        (v) => !process.env[v]
      )
    );
  }
  return { clientId, clientSecret, authUrl, tokenUrl, redirectUri };
}

export function isGoogleOAuthConfigured(): boolean {
  try {
    getOAuthConfig();
    return true;
  } catch {
    return false;
  }
}

/** Builds the consent-screen URL the browser is redirected to. access_type
 * "offline" + prompt "consent" are both required to actually receive a
 * refresh token — without "consent", Google silently skips re-issuing one
 * for a user who already authorized this app once before (a common cause
 * of "it worked in testing, then refresh_token was null in production"
 * bugs), so this is deliberately always forced on every authorization
 * request, not just the first. `state` is an opaque, server-signed value
 * (see services/googleOAuthState.ts) — this function never interprets it,
 * only passes it through for the callback to verify. */
export function buildAuthorizationUrl(state: string): string {
  const { clientId, authUrl, redirectUri } = getOAuthConfig();
  const url = new URL(authUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export type GoogleTokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
  grantedScopes: string;
};

async function postForm<T>(url: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new GoogleApiError(res.status, data.error_description ?? data.error ?? res.statusText);
  }
  return data as T;
}

/** The authorization-code exchange — called exactly once, right after the
 * user is redirected back to our callback. A refresh_token is only present
 * here because buildAuthorizationUrl always forces prompt=consent; callers
 * must treat a missing refreshToken as the one failure mode worth
 * surfacing distinctly (see emailOnboarding.ts). */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, tokenUrl, redirectUri } = getOAuthConfig();
  const data = await postForm<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  }>(tokenUrl, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresInSeconds: data.expires_in,
    grantedScopes: data.scope,
  };
}

/** Exchanges a stored refresh token for a fresh access token — called
 * on-demand right before a send/sync call finds its cached access token
 * expired (see emailOnboarding.ts's getValidAccessToken), never eagerly on
 * a schedule. Google does not return a new refresh_token on this grant
 * type, so the caller keeps using the one already stored. */
export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const { clientId, clientSecret, tokenUrl } = getOAuthConfig();
  const data = await postForm<{ access_token: string; expires_in: number }>(tokenUrl, {
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
}

/** Resolves which address was actually connected — used once, right after
 * the token exchange, to populate company_email_accounts.email_address.
 * Never re-called afterward; the stored address is the source of truth
 * from then on. */
export async function getConnectedEmailAddress(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new GoogleApiError(res.status, data.error?.message ?? res.statusText);
  if (!data.email) throw new GoogleApiError(res.status, "Google did not return an email address for this account.");
  return data.email as string;
}

/** Gmail's own current historyId for this mailbox, via users.getProfile —
 * unlike watchMailbox, this needs no Pub/Sub topic at all, so it's what
 * lets gmailSync.ts establish a usable "only new from here on" baseline
 * cursor even when push notifications aren't configured (local dev
 * polling — see gmailSync.ts's establishHistoryBaseline) or as the
 * re-baseline step when history itself has expired. */
export async function getProfile(accessToken: string): Promise<{ emailAddress: string; historyId: string }> {
  const res = await fetch(`${GMAIL_API_BASE}/users/me/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new GoogleApiError(res.status, data.error?.message ?? res.statusText);
  return { emailAddress: data.emailAddress, historyId: String(data.historyId) };
}

/** Builds the base64url-encoded RFC 2822 message Gmail's send endpoint
 * requires. Deliberately plain text only for this phase (no HTML, no
 * attachments) — matches this app's existing Resend-based sendEmail
 * exactly in shape (to/subject/body), so services/email.ts's call sites
 * don't need to change when this provider is wired in. */
function buildRawMessage(input: { to: string; subject: string; body: string }): string {
  const message = [`To: ${input.to}`, `Subject: ${input.subject}`, "Content-Type: text/plain; charset=utf-8", "", input.body].join(
    "\r\n"
  );
  return Buffer.from(message).toString("base64url");
}

/** Sends via Gmail's users.messages.send — the connected mailbox is the
 * sender, identified implicitly by whichever access token is passed in
 * (Gmail's API scopes every call to the authenticated user's own mailbox,
 * there is no separate "from" parameter to get wrong). */
export async function sendGmailMessage(
  accessToken: string,
  input: { to: string; subject: string; body: string }
): Promise<{ externalId: string | null }> {
  const res = await fetch(`${GMAIL_API_BASE}/users/me/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: buildRawMessage(input) }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new GoogleApiError(res.status, data.error?.message ?? res.statusText);
  }
  return { externalId: data.id ?? null };
}

export type WatchResult = { historyId: string; expiration: Date };

/** Registers (or renews) Gmail push notifications for this mailbox via
 * Cloud Pub/Sub — Gmail has no webhook/long-poll of its own; this is the
 * only way to learn about new mail without polling. Every watch expires
 * after at most ~7 days (Google's own cap) and must be renewed before then
 * — see emailOnboarding.ts's registerWatch, called once right after
 * connect; periodic renewal is not yet wired in (documented as the one
 * known gap in this phase, see gmailSync.ts's module comment). Requires
 * GOOGLE_PUBSUB_TOPIC (`projects/<project>/topics/<topic>`) to exist and
 * already grant Publish rights to gmail-api-push@system.gserviceaccount.com
 * — both are one-time, manual Google Cloud Console setup this server has
 * no credentials to perform itself. */
export function isGmailPubSubConfigured(): boolean {
  return !!process.env.GOOGLE_PUBSUB_TOPIC;
}

export async function watchMailbox(accessToken: string): Promise<WatchResult> {
  const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
  if (!topicName) throw new ProviderNotConfiguredError("Gmail Pub/Sub", ["GOOGLE_PUBSUB_TOPIC"]);

  const res = await fetch(`${GMAIL_API_BASE}/users/me/watch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ topicName, labelIds: ["INBOX"], labelFilterAction: "include" }),
  });
  const data = await res.json();
  if (!res.ok) throw new GoogleApiError(res.status, data.error?.message ?? res.statusText);
  return { historyId: String(data.historyId), expiration: new Date(Number(data.expiration)) };
}

/** Stops push notifications for this mailbox — called best-effort on
 * disconnect (see emailOnboarding.disconnectAccount) so a disconnected
 * mailbox doesn't keep notifying Pub/Sub. A 404 here just means there was
 * no active watch to stop, which is fine, not an error. */
export async function stopWatch(accessToken: string): Promise<void> {
  const res = await fetch(`${GMAIL_API_BASE}/users/me/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new GoogleApiError(res.status, data.error?.message ?? res.statusText);
  }
}

export type HistoryListResult = {
  messageIds: string[];
  newHistoryId: string;
  /** true when Google reports startHistoryId is too old to resume from
   * (history beyond Gmail's retention window) — the caller must re-baseline
   * with a fresh watch rather than retry; see gmailSync.ts. */
  expired: boolean;
};

/** Lists everything added to this mailbox since `startHistoryId`, paginating
 * through every page until exhausted. historyTypes is restricted to
 * messageAdded only, so a label being toggled (e.g. read/unread, a filter
 * applying "IMPORTANT") never produces a spurious sync — only genuinely new
 * messages (received or sent) do. */
export async function listHistory(accessToken: string, startHistoryId: string): Promise<HistoryListResult> {
  const messageIds: string[] = [];
  let pageToken: string | undefined;
  let newHistoryId = startHistoryId;

  do {
    const url = new URL(`${GMAIL_API_BASE}/users/me/history`);
    url.searchParams.set("startHistoryId", startHistoryId);
    url.searchParams.set("historyTypes", "messageAdded");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 404) return { messageIds: [], newHistoryId: startHistoryId, expired: true };
      throw new GoogleApiError(res.status, data.error?.message ?? res.statusText);
    }

    for (const record of data.history ?? []) {
      for (const added of record.messagesAdded ?? []) {
        if (added.message?.id) messageIds.push(added.message.id);
      }
    }
    if (data.historyId) newHistoryId = String(data.historyId);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return { messageIds, newHistoryId, expired: false };
}

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds: string[];
  internalDate: Date;
  from: { name: string | null; email: string | null };
  /** First address in the To header only — good enough for gmailSync.ts's
   * contact-matching on a message sent FROM this mailbox directly (not via
   * sendFromAccount), never parsed for correctness beyond that one use; a
   * multi-recipient message just matches against whichever address Gmail's
   * header happens to list first. */
  to: { name: string | null; email: string | null };
  subject: string | null;
  body: string;
};

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

type GmailMessagePart = { mimeType?: string; body?: { data?: string }; parts?: GmailMessagePart[] };

/** Breadth-first search for the best human-readable body: prefers the
 * first text/plain part; falls back to the first text/html part (tags
 * stripped, best-effort — this is for CRM display, not rendering) when no
 * plain-text part exists, which is common for marketing-style HTML-only
 * emails. */
export function extractBody(payload: GmailMessagePart | undefined): string {
  const queue: GmailMessagePart[] = payload ? [payload] : [];
  let htmlFallback: string | null = null;

  while (queue.length) {
    const part = queue.shift()!;
    const data = part.body?.data;
    if (part.mimeType === "text/plain" && data) return decodeBase64Url(data);
    if (part.mimeType === "text/html" && data && !htmlFallback) htmlFallback = decodeBase64Url(data);
    if (part.parts) queue.push(...part.parts);
  }

  if (htmlFallback) {
    return htmlFallback
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

/** Parses `"Name" <email@x.com>` / `email@x.com` header formats — Gmail's
 * From header is never guaranteed to include a display name. */
export function parseFromHeader(value: string | undefined): { name: string | null; email: string | null } {
  if (!value) return { name: null, email: null };
  const match = value.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].replace(/^"|"$/g, "").trim();
    return { name: name || null, email: match[2].trim().toLowerCase() };
  }
  return { name: null, email: value.trim().toLowerCase() };
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string | undefined {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

/** Same address format as parseFromHeader, but only the FIRST entry of a
 * header that may list several comma-separated recipients (To/Cc) — splits
 * on the first top-level comma (the one after a `<...>` pair, if present,
 * so a quoted display name's own comma, e.g. "Doe, Jane" <jane@x.com>,
 * never causes a false split) rather than attempting to parse every
 * recipient. */
export function parseFirstAddress(value: string | undefined): { name: string | null; email: string | null } {
  if (!value) return { name: null, email: null };
  const angleEnd = value.indexOf(">");
  const firstEntry = angleEnd !== -1 ? value.slice(0, angleEnd + 1) : value.split(",")[0];
  return parseFromHeader(firstEntry.trim());
}

/** Fetches one full message's content — called once per new message id
 * surfaced by listHistory. format=full is required to get both headers
 * (From/Subject) and the body payload in a single call. */
export async function getMessage(accessToken: string, messageId: string): Promise<GmailMessage> {
  const res = await fetch(`${GMAIL_API_BASE}/users/me/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new GoogleApiError(res.status, data.error?.message ?? res.statusText);

  const headers: Array<{ name: string; value: string }> = data.payload?.headers ?? [];
  return {
    id: data.id,
    threadId: data.threadId,
    labelIds: data.labelIds ?? [],
    internalDate: new Date(Number(data.internalDate)),
    from: parseFromHeader(getHeader(headers, "From")),
    to: parseFirstAddress(getHeader(headers, "To")),
    subject: getHeader(headers, "Subject") ?? null,
    body: extractBody(data.payload),
  };
}
