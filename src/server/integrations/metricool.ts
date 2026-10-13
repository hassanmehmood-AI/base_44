import { ProviderNotConfiguredError } from "./errors";

/** Metricool Smart Inbox wrapper — lets the Social Media channel send/receive
 * Instagram and Facebook DMs via Metricool's API, as a second provider
 * alongside (not replacing) the direct Meta Graph API in meta.ts. Endpoint
 * paths and schemas below were pulled directly from Metricool's published
 * OpenAPI spec (https://app.metricool.com/api/swagger.json — "Conversations
 * Api Service" / "Inbox Status Change Api Service" tags), not guessed — but
 * like meta.ts/zadarma.ts/email.ts, not yet verified against a live call;
 * re-check response shapes once METRICOOL_API_TOKEN is set and the first
 * real sync runs.
 *
 * Auth: every request needs header `X-Mc-Auth: <token>` plus query params
 * `userId` and `blogId` (confirmed via Metricool's help-center docs — the
 * formal OpenAPI spec only lists `provider` per operation, which looks like
 * a gap in Metricool's own spec authoring rather than those two params
 * being optional). One shared Metricool account (METRICOOL_API_TOKEN /
 * METRICOOL_USER_ID) is used across every CRM company; each company maps to
 * its own Metricool `blogId` via company_social_accounts (platform
 * METRICOOL_INSTAGRAM/METRICOOL_FACEBOOK, externalPageId = that company's
 * blogId — see src/db/schema.ts).
 */

const API_BASE = "https://app.metricool.com/api";

/** Metricool supports more networks (TIKTOKBUSINESS, YOUTUBE, GMB, LINKEDIN,
 * TWITTER...), but only Instagram/Facebook are in scope here — those are
 * the two private-message-capable networks this CRM's companies use. */
export type MetricoolProvider = "INSTAGRAM" | "FACEBOOK";

export type MetricoolMessage = {
  id: string;
  from: string;
  to: string;
  text: string;
  publicationDateTime: string;
  attachments: string[];
  status: "NEW" | "READ" | "DELETED";
};

export type MetricoolParticipant = {
  id: string;
  name: string;
  email: string;
  imageProfileUrl: string;
};

export type MetricoolConversation = {
  id: string;
  provider: string;
  status: "PENDING" | "READ" | "RESOLVED";
  creationDate: string;
  lastUpdateTime: string;
  lastReadTime: string;
  participants: MetricoolParticipant[];
  messages: MetricoolMessage[];
};

export type MetricoolBrand = {
  id: number;
  label: string;
  title: string;
  image: string;
  availableConnectors: string[];
};

export type MetricoolConnectionLink = {
  link: string;
  expiresAt: string | null;
};

function getCredentials(): { token: string; userId: string } {
  const token = process.env.METRICOOL_API_TOKEN;
  const userId = process.env.METRICOOL_USER_ID;
  if (!token || !userId) {
    throw new ProviderNotConfiguredError(
      "Metricool",
      ["METRICOOL_API_TOKEN", "METRICOOL_USER_ID"].filter((v) => !process.env[v])
    );
  }
  return { token, userId };
}

export function isMetricoolConfigured(): boolean {
  return Boolean(process.env.METRICOOL_API_TOKEN && process.env.METRICOOL_USER_ID);
}

/** `blogId: null` for account-level calls that aren't scoped to one brand
 * yet (listing/creating brands) — every other call is scoped to a specific
 * brand. `body` as a `FormData` instance is sent as-is (multipart, its own
 * boundary header); any other `body` is JSON-encoded. */
async function metricoolFetch<T>(
  path: string,
  blogId: string | null,
  init?: { method?: string; query?: Record<string, string>; body?: unknown }
): Promise<T> {
  const { token, userId } = getCredentials();
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set("userId", userId);
  if (blogId) url.searchParams.set("blogId", blogId);
  for (const [key, value] of Object.entries(init?.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const isFormData = init?.body instanceof FormData;
  const res = await fetch(url.toString(), {
    method: init?.method ?? "GET",
    headers: {
      "X-Mc-Auth": token,
      ...(init?.body && !isFormData ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? (isFormData ? (init.body as FormData) : JSON.stringify(init.body)) : undefined,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Metricool API error (${res.status}): ${data?.message ?? res.statusText}`);
  }
  return data as T;
}

/** GET /v2/inbox/conversations — full conversation list for one connected
 * account/provider, each with its messages embedded. This is also the sync
 * source: compare `lastUpdateTime` against what's already stored to find
 * new inbound messages (see socialService.syncMetricoolConversations). */
export async function listConversations(blogId: string, provider: MetricoolProvider): Promise<MetricoolConversation[]> {
  const result = await metricoolFetch<{ data: MetricoolConversation[] }>("/v2/inbox/conversations", blogId, {
    query: { provider },
  });
  return result.data;
}

/** POST /v2/inbox/conversations — reply within an existing conversation.
 * `recipient` is the external participant id to reply to (expected to be
 * the Conversation.participants[] entry that isn't the brand's own account)
 * — confirm the exact value against a live conversation payload before the
 * first real send. Returns whatever id Metricool assigns the new message. */
export async function sendMessage(
  blogId: string,
  provider: MetricoolProvider,
  conversationId: string,
  recipient: string,
  text: string
): Promise<string> {
  const result = await metricoolFetch<{ data: string }>("/v2/inbox/conversations", blogId, {
    method: "POST",
    body: { provider, conversationId, recipient, text },
  });
  return result.data;
}

/** PUT /v2/inbox/status — mark a conversation read/resolved. Metricool's
 * spec requires `conversationType` with no documented value set or example;
 * confirm the expected literal against a live response before relying on
 * this. Not called by the MVP sync/reply flow in social.ts. */
export async function changeConversationStatus(
  blogId: string,
  provider: MetricoolProvider,
  conversationId: string,
  conversationType: string,
  status: string
): Promise<void> {
  await metricoolFetch<unknown>("/v2/inbox/status", blogId, {
    method: "PUT",
    body: { provider, conversationType, conversationId, status },
  });
}

/** GET /v2/inbox/conversations/authorizations — whether this Metricool
 * account's connection to `provider` is actually authorized for the Inbox
 * feature. Useful as a one-off connection health check per blogId/provider;
 * not called from the regular sync/reply path. */
export async function verifyAuthorization(blogId: string, provider: MetricoolProvider): Promise<unknown> {
  const result = await metricoolFetch<{ data: unknown }>("/v2/inbox/conversations/authorizations", blogId, {
    query: { provider },
  });
  return result.data;
}

// ---------------------------------------------------------------------------
// Brand provisioning (company onboarding) — account-level, not scoped to a
// blogId since the brand either doesn't exist yet or isn't tied to one
// conversation flow. `/admin/add-profile` is explicitly marked deprecated in
// Metricool's own spec ("Use POST /v2/settings/brands instead") — this uses
// the current endpoint, not the deprecated one the feature was first
// described with.
// ---------------------------------------------------------------------------

/** GET /v2/settings/brands — every brand (Metricool's term for what this
 * CRM treats as one company's connected account) under the shared Metricool
 * account. Used to detect an existing brand before creating a duplicate,
 * and to populate the "link an existing brand" picker. */
export async function listBrands(): Promise<MetricoolBrand[]> {
  const result = await metricoolFetch<{ data: MetricoolBrand[] }>("/v2/settings/brands", null);
  return result.data;
}

/** GET /v2/settings/brands/{brand-id} — current connection state for one
 * brand. `availableConnectors` is the live signal for "is Instagram/Facebook
 * actually connected yet" — exact string values (e.g. "INSTAGRAM" vs
 * "instagram") aren't confirmed from the spec alone; callers match
 * case-insensitively and should verify against a live response. */
export async function getBrand(blogId: string): Promise<MetricoolBrand> {
  const result = await metricoolFetch<{ data: MetricoolBrand }>(`/v2/settings/brands/${blogId}`, blogId);
  return result.data;
}

/** POST /v2/settings/brands — creates a new, empty brand (shows as such in
 * Metricool until its first social account is connected). multipart/form-data
 * per Metricool's prose spec description (the formal OpenAPI requestBody for
 * this operation is empty — a gap in their spec authoring, same pattern as
 * other gaps already found in this file) — only sends the one field this
 * integration needs, `brandLabel`; `agencyId`/`organizationId`/`picture` are
 * all optional and intentionally omitted. Throws on a 403 (brand limit
 * reached) via metricoolFetch's generic error handling — callers (see
 * metricoolOnboarding.ts) are expected to catch and surface that clearly
 * rather than silently fail company creation. */
export async function createBrand(label: string): Promise<MetricoolBrand> {
  const form = new FormData();
  form.set("brandLabel", label);
  const result = await metricoolFetch<{ data: MetricoolBrand }>("/v2/settings/brands", null, {
    method: "POST",
    body: form,
  });
  return result.data;
}

/** POST /v2/settings/brands/connections/anonymous-link — Metricool's only
 * officially-supported way to connect a social account without a user
 * logging into Metricool directly: a shareable link to Metricool's own
 * hosted "Brand settings > Connections" panel, where the authorized person
 * completes the real Instagram/Facebook OAuth consent themselves. There is
 * no API that connects a social account directly (e.g. by just posting a
 * username) — Meta's platform requires actual user consent, which only this
 * kind of hosted flow (or a from-scratch Meta Login integration, already
 * covered by the separate meta.ts provider) can obtain. Requires Metricool's
 * Advanced plan or higher (confirmed already met). Generating a new link
 * invalidates any previously generated one for this brand. */
export async function createConnectionLink(blogId: string): Promise<MetricoolConnectionLink> {
  const result = await metricoolFetch<{ data: { link: string; expiresAt?: string | null } }>(
    "/v2/settings/brands/connections/anonymous-link",
    blogId,
    { method: "POST" }
  );
  return { link: result.data.link, expiresAt: result.data.expiresAt ?? null };
}
