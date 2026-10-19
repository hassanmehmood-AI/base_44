import { ProviderNotConfiguredError } from "./errors";

/** Whapi.Cloud Partner API wrapper — lets a Superuser create and manage one
 * WhatsApp channel per CRM company directly from Configuración, the Whapi
 * equivalent of integrations/metricool.ts's brand provisioning. Every
 * endpoint path, field name, and response shape below was confirmed against
 * Whapi's live documentation during this build (manager.whapi.cloud create-
 * channel reference, the Partner "channel creation" help page, the
 * /users/login and /health channel-API references, and the "Customizable
 * Webhook Headers" help page) — not guessed.
 *
 * Two distinct credential scopes, never mixed:
 *  - The Partner Token (WHAPI_PARTNER_TOKEN) only ever calls
 *    manager.whapi.cloud, and only for create/manage operations across every
 *    company's channel.
 *  - Each channel's OWN token (minted once, at creation, in the create
 *    response) is required for every call scoped to that one channel — QR
 *    retrieval, health, settings, sending a message — against that
 *    channel's own `apiUrl`, never manager.whapi.cloud. This is the one
 *    structural difference from Metricool's single shared account token:
 *    see db/schema.ts's whapiChannels comment for why that token is
 *    encrypted at rest instead of stored as a plain id. */

const MANAGER_API_BASE = "https://manager.whapi.cloud";

/** The custom callback header name registered on every channel via
 * setWebhook below — shared with api/webhooks/whapi/route.ts, which checks
 * for this exact header. Centralized here so the "set" side and the
 * "verify" side can never drift out of sync on the header's name. */
export const WEBHOOK_SECRET_HEADER_NAME = "X-Whapi-Webhook-Secret";

export function isWhapiPartnerConfigured(): boolean {
  return Boolean(process.env.WHAPI_PARTNER_TOKEN && process.env.WHAPI_PROJECT_ID);
}

function getPartnerCredentials(): { token: string; projectId: string } {
  const token = process.env.WHAPI_PARTNER_TOKEN;
  const projectId = process.env.WHAPI_PROJECT_ID;
  if (!token || !projectId) {
    throw new ProviderNotConfiguredError("Whapi", ["WHAPI_PARTNER_TOKEN", "WHAPI_PROJECT_ID"].filter((v) => !process.env[v]));
  }
  return { token, projectId };
}

/** Same transient-failure retry policy as integrations/metricool.ts's
 * metricoolFetch, for the same reason: 429/5xx mean the provider itself
 * responded and said the request didn't succeed, so retrying is safe; a
 * genuine network timeout/no-response is deliberately NOT retried from
 * inside this helper — for createChannel specifically (a paid, non-
 * idempotent operation), the caller (whapiOnboarding.ts) is responsible for
 * treating that ambiguous case as "needs manual confirmation", never an
 * automatic retry. */
const MAX_RETRY_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WhapiApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "WhapiApiError";
  }
}

async function whapiFetch<T>(
  url: string,
  token: string,
  init?: { method?: string; query?: Record<string, string>; body?: unknown }
): Promise<T> {
  const fullUrl = new URL(url);
  for (const [key, value] of Object.entries(init?.query ?? {})) {
    fullUrl.searchParams.set(key, value);
  }

  const requestInit: RequestInit = {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  };

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(fullUrl.toString(), requestInit);
    const data = await res.json().catch(() => null);
    if (res.ok) return data as T;

    if (!isRetryableStatus(res.status) || attempt >= MAX_RETRY_ATTEMPTS) {
      throw new WhapiApiError(res.status, `Whapi API error (${res.status}): ${data?.message ?? res.statusText}`);
    }

    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
    const backoffMs = Number.isFinite(retryAfterMs) ? retryAfterMs : BASE_BACKOFF_MS * 2 ** attempt;
    const jitterMs = Math.random() * 250;
    await sleep(Math.min(backoffMs, MAX_BACKOFF_MS) + jitterMs);
  }
}

export type WhapiCreateChannelResult = {
  id: string;
  token: string;
  apiUrl: string;
  server: string;
  activeTill: number | null;
  stopped: boolean;
};

/** PUT https://manager.whapi.cloud/channels — Partner-token-scoped, the one
 * paid/non-idempotent call in this whole integration. The response's `token`
 * is this new channel's OWN secret (see module doc comment) — callers must
 * encrypt it (secretBox.ts) before any DB write and never log or return it
 * to a browser. `apiUrl` is where every subsequent channel-scoped call for
 * this company goes. */
export async function createChannel(name: string): Promise<WhapiCreateChannelResult> {
  const { token, projectId } = getPartnerCredentials();
  const result = await whapiFetch<{
    id: string;
    token: string;
    apiUrl: string;
    server: string;
    activeTill?: number | null;
    stopped?: boolean;
  }>(`${MANAGER_API_BASE}/channels`, token, {
    method: "PUT",
    body: { name, projectId },
  });
  return {
    id: result.id,
    token: result.token,
    apiUrl: result.apiUrl,
    server: result.server,
    activeTill: result.activeTill ?? null,
    stopped: result.stopped ?? false,
  };
}

export type WhapiQrResult = {
  status: "OK" | "TIMEOUT" | "WAITING" | "ERROR" | string;
  base64: string | null;
};

/** GET {apiUrl}/users/login — channel-token-scoped. Returns a QR image (as a
 * base64 PNG, per Whapi's own docs) for the Configuración modal to render;
 * the authorized person scans it with the company's actual WhatsApp app
 * (Linked Devices). Never proxies or stores this image — rendered once,
 * discarded by the client. */
export async function getQrCode(apiUrl: string, channelToken: string): Promise<WhapiQrResult> {
  const result = await whapiFetch<{ status: string; base64?: string }>(`${apiUrl}/users/login`, channelToken);
  return { status: result.status, base64: result.base64 ?? null };
}

export type WhapiHealthStatus = {
  statusText: "NOT_INIT" | "INIT" | "LAUNCH" | "QR" | "AUTH" | "ERROR" | "SYNC_ERROR" | string;
  connected: boolean;
  phone: string | null;
};

/** GET {apiUrl}/health — channel-token-scoped. `status.text === "AUTH"` is
 * Whapi's own documented signal for "a real WhatsApp number is linked and
 * the channel is operational" — the equivalent of Metricool's
 * networksData.<network>Data presence check in integrations/metricool.ts. */
export async function getChannelHealth(apiUrl: string, channelToken: string): Promise<WhapiHealthStatus> {
  const result = await whapiFetch<{ status: { text: string }; user?: { phone?: string } }>(`${apiUrl}/health`, channelToken, {
    query: { wakeup: "false" },
  });
  return {
    statusText: result.status.text,
    connected: result.status.text === "AUTH",
    phone: result.user?.phone ?? null,
  };
}

/** PATCH {apiUrl}/settings — channel-token-scoped. Registers our webhook URL
 * AND a custom callback header (see "Customizable Webhook Headers" in
 * Whapi's docs) carrying a secret we generated ourselves — this is the
 * compensating control for the inbound webhook route to check, since Whapi's
 * webhook deliveries carry no native HMAC/signature (confirmed against
 * Whapi's own webhook docs — there is no signing mechanism documented).
 * Whapi's docs explicitly warn that omitted settings fields reset to
 * defaults on this endpoint, so every call here sends the full `webhooks`
 * block in one shot rather than a partial patch. */
export async function setWebhook(
  apiUrl: string,
  channelToken: string,
  webhookUrl: string,
  headerName: string,
  headerSecret: string
): Promise<void> {
  await whapiFetch<unknown>(`${apiUrl}/settings`, channelToken, {
    method: "PATCH",
    body: {
      webhooks: [
        {
          mode: "body",
          events: [{ type: "messages", method: "post" }],
          url: webhookUrl,
          headers: { [headerName]: headerSecret },
        },
      ],
    },
  });
}

/** POST {apiUrl}/messages/text — channel-token-scoped. `to` accepts the raw
 * chat_id Whapi gave us on the inbound webhook (see whapi_inbound_events'
 * rawPayload.messages[].chat_id), confirmed as the correct recipient field
 * name/shape against Whapi's own sendMessageText reference. */
export async function sendTextMessage(apiUrl: string, channelToken: string, to: string, body: string): Promise<string> {
  const result = await whapiFetch<{ sent: boolean; message?: { id?: string } }>(`${apiUrl}/messages/text`, channelToken, {
    method: "POST",
    body: { to, body },
  });
  if (!result.sent) throw new Error("Whapi reported the message was not sent.");
  if (!result.message?.id) throw new Error("Whapi did not return a message id for this send.");
  return result.message.id;
}
