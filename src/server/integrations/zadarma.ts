import { createHash, createHmac, timingSafeEqual } from "crypto";
import { ProviderNotConfiguredError } from "./errors";

/** Zadarma API wrapper, scaffolded ahead of a real account per guide §16 —
 * the API key/secret aren't set yet, so every call here throws
 * ProviderNotConfiguredError until the product owner adds them.
 *
 * Signing follows Zadarma's documented REST API auth scheme
 * (https://zadarma.com/en/support/api/): sort params, md5 the param string,
 * HMAC-SHA1(secret, path + paramString + md5), then base64 the *hex* digest
 * (not the raw bytes — that's a Zadarma-specific quirk). This has not been
 * verified against a live account; re-check against Zadarma's docs/a real
 * request once ZADARMA_API_KEY/ZADARMA_API_SECRET are set — see
 * zadarmaNumberOnboarding.ts's purchaseNumber for how a signature mismatch
 * surfaces (a clean 4xx from Zadarma, not a crash).
 *
 * Virtual-number endpoints (countries/destinations/available/order/...)
 * were added from Zadarma's published docs
 * (zadarma.com/en/support/api/ and .../instructions/api/numbers/) — same
 * "scaffolded against docs, unverified against a live call" status as the
 * original requestCallback below. */

const API_BASE = "https://api.zadarma.com";

/** Distinguishable failure modes for the Buy Zadarma Number wizard — see
 * request()'s classification below. Callers (zadarmaNumberOnboarding.ts,
 * then the Configuración actions) narrow on these instead of pattern-
 * matching an error message string, so "no numbers for this destination"
 * (a normal, successful empty response) can never be confused with "your
 * credentials are wrong" or "Zadarma is rate-limiting you" — three
 * completely different problems that need three different user-facing
 * messages and different retry affordances. */
export class ZadarmaAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZadarmaAuthError";
  }
}
export class ZadarmaRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZadarmaRateLimitError";
  }
}
/** Thrown when the request never got a real HTTP response at all (fetch
 * rejected, DNS failure, timeout) or Zadarma responded with a body that
 * isn't even parseable JSON — genuinely different from ZadarmaApiError
 * below, where Zadarma DID respond with a clean, understood error. */
export class ZadarmaNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZadarmaNetworkError";
  }
}
/** A clean rejection FROM Zadarma itself (a 4xx/5xx with a real parsed
 * body, or status: "error") that isn't specifically auth or rate-limit —
 * e.g. a bad direction_id, an invalid document group. */
export class ZadarmaApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZadarmaApiError";
  }
}

function getCredentials(): { key: string; secret: string } {
  const key = process.env.ZADARMA_API_KEY;
  const secret = process.env.ZADARMA_API_SECRET;
  if (!key || !secret) {
    throw new ProviderNotConfiguredError("Zadarma", ["ZADARMA_API_KEY", "ZADARMA_API_SECRET"].filter((v) => !process.env[v]));
  }
  return { key, secret };
}

export function isZadarmaConfigured(): boolean {
  return Boolean(process.env.ZADARMA_API_KEY && process.env.ZADARMA_API_SECRET);
}

function sign(path: string, params: Record<string, string>, secret: string): string {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map((k) => `${k}=${params[k]}`).join("&");
  const md5Params = createHash("md5").update(paramString).digest("hex");
  const stringToSign = path + paramString + md5Params;
  const hmacHex = createHmac("sha1", secret).update(stringToSign).digest("hex");
  return Buffer.from(hmacHex).toString("base64");
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** `path` is the API path (e.g. "/v1/direct_numbers/order/"), never a
 * literal HTTP verb — kept named this way (not `method`) to avoid confusion
 * with the new `httpMethod` param below. GET sends `params` as a query
 * string (the original, confirmed-scaffolded behavior); POST/PUT send them
 * as a form-urlencoded body instead, per Zadarma's documented convention —
 * the signature covers the exact same param set either way. The POST/PUT
 * path is new and unverified; re-check on the first real order/ call. */
async function request(path: string, params: Record<string, string> = {}, httpMethod: HttpMethod = "GET"): Promise<unknown> {
  const { key, secret } = getCredentials();
  const signature = sign(path, params, secret);
  const query = new URLSearchParams(params).toString();

  const headers: Record<string, string> = { Authorization: `${key}:${signature}` };
  let url = `${API_BASE}${path}`;
  let body: string | undefined;

  if (httpMethod === "GET" || httpMethod === "DELETE") {
    url += query ? `?${query}` : "";
  } else {
    body = query;
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  let res: Response;
  try {
    res = await fetch(url, { method: httpMethod, headers, body });
  } catch (e) {
    throw new ZadarmaNetworkError(e instanceof Error ? e.message : "Could not reach Zadarma — check your network connection.");
  }

  let data: { status?: string; message?: string; [key: string]: unknown };
  try {
    data = await res.json();
  } catch {
    throw new ZadarmaNetworkError(`Zadarma returned an unreadable response (HTTP ${res.status}).`);
  }

  classifyAndThrow(res.status, data);
  return data;
}

/** Shared by request() and uploadDocument()'s own manual fetch below — one
 * place that decides which of the four error types above a given HTTP
 * status/body represents, so both call paths stay consistent. Does nothing
 * (returns normally) when the response is actually successful. */
function classifyAndThrow(status: number, data: { status?: string; message?: string }): void {
  if (status === 401 || status === 403) {
    throw new ZadarmaAuthError(data.message ?? "Zadarma rejected these API credentials — check ZADARMA_API_KEY/ZADARMA_API_SECRET.");
  }
  if (status === 429) {
    throw new ZadarmaRateLimitError(data.message ?? "Zadarma is rate-limiting this account — wait a moment and try again.");
  }
  if (status < 200 || status >= 300 || data.status === "error") {
    throw new ZadarmaApiError(data.message ?? `Zadarma API error (HTTP ${status}).`);
  }
}

/** "Request a callback" — Zadarma dials `from` first, then bridges to `to`
 * once answered. This is the click-to-call primitive; it doesn't require an
 * embedded WebRTC widget, so it's the right first piece to scaffold. */
export async function requestCallback(from: string, to: string): Promise<void> {
  await request("/v1/request/callback/", { from, to });
}

// ---------------------------------------------------------------------------
// Virtual number purchasing — read endpoints (safe to call freely, no cost)
// ---------------------------------------------------------------------------

export type ZadarmaCountry = { countryCode: string; countryCodeIso: string; name: string };

/** GET /v1/direct_numbers/countries/ — every field name below is exactly as
 * Zadarma's docs describe it (not camelCased/renamed). Confirmed live
 * (2026-11-10, real account): the array is wrapped under `info`, not
 * `countries` as the docs implied — this was the one real bug the live
 * test surfaced; everything else (auth/signing) worked correctly on the
 * first real call. */
export async function listCountries(): Promise<ZadarmaCountry[]> {
  const data = (await request("/v1/direct_numbers/countries/")) as { info?: ZadarmaCountry[] };
  return data.info ?? [];
}

export type ZadarmaDestination = {
  // Confirmed live (2026-11-10): a JSON number (e.g. 1014), not a string as
  // originally assumed from the docs — callers pass String(id) at the
  // point of use (building a URL path/query param) rather than this type
  // lying about what Zadarma actually sends.
  id: number;
  areaCode: string;
  name: string;
  // Confirmed live (2026-11-10): numbers, not strings as the docs implied —
  // callers already coerce via Number()/template interpolation, so this is
  // a type-accuracy fix, not a behavior change.
  connect_fee: number;
  monthly_fee: number;
  currency: string;
  // Confirmed live: a real nested object ({upload: {...}, specify: [...]}),
  // never a plain string — the UI only checks for presence of either key to
  // show a generic "documents required" notice, since the exact wording
  // inside is account-language-dependent (observed in Spanish on this
  // account) and not safe to pattern-match on.
  restrictions?: { upload?: Record<string, string>; specify?: string[] };
  // Confirmed live: the literal STRING "true"/"false", not a boolean — a
  // bare truthy check on this field would incorrectly treat "false" (a
  // non-empty string) as SMS-capable. Callers must compare against the
  // string "true" explicitly.
  receive_sms?: string;
  is_toll?: string;
  connect_time?: string;
  /** Confirmed live against a real account (2026-11-10): present for
   * large/federal countries — US returned it on 1,124 of 1,130 destinations
   * (48 distinct states) — and completely ABSENT for others (UK: 0 of 176;
   * Pakistan: 0 of 3). Never fabricated when missing: callers must treat a
   * country where zero destinations carry this field as "no state/region
   * grouping exists for this country," not an error or a gap to fill in. */
  stateCode?: string;
};

/** GET /v1/direct_numbers/country/ — destinations (cities/areas) within one
 * country, each carrying its own pricing and document-requirement hints.
 * This is the data the "setup fees, recurring charges, required documents"
 * summary screen (Configuración's buy flow) is built from — never guessed,
 * never hardcoded. */
export async function listDestinations(countryCodeIso: string): Promise<ZadarmaDestination[]> {
  // Confirmed live (2026-11-10): wrapped under `info`, same as
  // listCountries — not `destinations` as the docs implied.
  const data = (await request("/v1/direct_numbers/country/", { country: countryCodeIso })) as { info?: ZadarmaDestination[] };
  return data.info ?? [];
}

/** `id` is confirmed live to be inconsistent in shape across results — some
 * numbers come back with a string id ("dw_15054079172"), others a plain
 * JSON number (1660428) — Zadarma's own API is simply not consistent here,
 * not a parsing bug on this side. Typed as the union so callers can't
 * assume one shape and silently mishandle the other; always String(id) at
 * the point of use. */
export type ZadarmaAvailableNumber = { id: string | number; direction_id: number; number: string };

/** GET /v1/direct_numbers/available/<DIRECTION_ID>/ — individual numbers
 * inherit the destination's own pricing (listDestinations above); this
 * endpoint only returns which numbers are currently available to buy. */
export async function listAvailableNumbers(directionId: string, mask?: string): Promise<ZadarmaAvailableNumber[]> {
  const data = (await request(`/v1/direct_numbers/available/${encodeURIComponent(directionId)}/`, mask ? { mask } : {})) as {
    numbers?: ZadarmaAvailableNumber[];
  };
  return data.numbers ?? [];
}

export type ZadarmaBalance = { balance: string; currency: string };

/** GET /v1/info/balance/ — used for a pre-purchase sufficient-funds check
 * (see zadarmaNumberOnboarding.ts's checkSufficientBalance). Best-effort
 * only: Zadarma's own order/ call remains the final authority and can still
 * reject an order for insufficient funds even if this check passed, since
 * balance can change between the check and the purchase click. */
export async function getBalance(): Promise<ZadarmaBalance> {
  return (await request("/v1/info/balance/")) as ZadarmaBalance;
}

export type ZadarmaDocumentGroup = {
  id: string;
  email?: string;
  salutation?: string;
  first_name?: string;
  last_name?: string;
  organization?: string;
  country?: string;
  city?: string;
  address?: string;
  phone?: string;
  type?: string;
};

/** GET /v1/documents/groups/list/ — lets the buy flow offer "reuse an
 * existing document group" instead of forcing a new one every purchase. */
export async function listDocumentGroups(): Promise<ZadarmaDocumentGroup[]> {
  const data = (await request("/v1/documents/groups/list/")) as { groups?: ZadarmaDocumentGroup[] };
  return data.groups ?? [];
}

// ---------------------------------------------------------------------------
// Virtual number purchasing — write endpoints (document setup is free;
// order/ is the one paid, non-idempotent call — see zadarmaNumberOnboarding.ts)
// ---------------------------------------------------------------------------

/** POST /v1/documents/groups/create/ — free; creates a reusable identity
 * record for future number orders in destinations that require one. Exact
 * required fields are not fully documented publicly; passing through
 * whatever the caller collected in the UI rather than guessing a stricter
 * shape here. */
export async function createDocumentGroup(fields: Record<string, string>): Promise<{ id: string }> {
  return (await request("/v1/documents/groups/create/", fields, "POST")) as { id: string };
}

/** POST /v1/documents/upload/ — free; attaches a file to a document group.
 * Uses multipart/form-data (not the signed form-urlencoded body every other
 * write call here uses) since it carries real file bytes — UNVERIFIED
 * whether Zadarma's signature should cover the file content or only the
 * metadata fields; this signs only the metadata fields (groupId/type/etc.),
 * matching every other endpoint's "sign the params, not the payload bytes"
 * pattern. Re-check against a real upload before relying on this. */
export async function uploadDocument(groupId: string, fileFieldName: string, file: Blob, filename: string, extraFields: Record<string, string> = {}): Promise<unknown> {
  const { key, secret } = getCredentials();
  const path = "/v1/documents/upload/";
  const signedParams = { group_id: groupId, ...extraFields };
  const signature = sign(path, signedParams, secret);

  const form = new FormData();
  form.set("group_id", groupId);
  for (const [k, v] of Object.entries(extraFields)) form.set(k, v);
  form.set(fileFieldName, file, filename);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `${key}:${signature}` },
      body: form,
    });
  } catch (e) {
    throw new ZadarmaNetworkError(e instanceof Error ? e.message : "Could not reach Zadarma — check your network connection.");
  }

  let data: { status?: string; message?: string; [key: string]: unknown };
  try {
    data = await res.json();
  } catch {
    throw new ZadarmaNetworkError(`Zadarma returned an unreadable response (HTTP ${res.status}).`);
  }

  classifyAndThrow(res.status, data);
  return data;
}

export type ZadarmaDocumentCheckErrors = { wrong_document?: { message: string }; wrong_address?: { message: string } };

/** GET /v1/direct_numbers/checking-wrongs/ — surfaces *why* a document group
 * failed verification, so the buy flow can show a real reason instead of a
 * generic failure. */
export async function getDocumentCheckErrors(groupId: string): Promise<ZadarmaDocumentCheckErrors> {
  return (await request("/v1/direct_numbers/checking-wrongs/", { group_id: groupId })) as ZadarmaDocumentCheckErrors;
}

export type ZadarmaOrderResult = { number: string; is_reserved: boolean; is_activated: boolean };

/** POST /v1/direct_numbers/order/ — the one paid, non-idempotent call in
 * this file. Callers MUST insert a PENDING row in zadarma_numbers (see
 * zadarmaNumbersRepo.insertPending) before calling this — see
 * zadarmaNumberOnboarding.ts's purchaseNumber for the full safe-purchase
 * flow (duplicate-click guard, ambiguous-failure handling). This function
 * itself does not know about the CRM's own database at all, same separation
 * every other integration file in this app keeps. */
export async function orderNumber(input: {
  directionId: string;
  documentsGroupId: string;
  numberId?: string;
  purpose?: string;
  receiveSms?: boolean;
  period?: string;
  autorenewPeriod?: string;
}): Promise<ZadarmaOrderResult> {
  const params: Record<string, string> = {
    direction_id: input.directionId,
    documents_group_id: input.documentsGroupId,
  };
  if (input.numberId) params.number_id = input.numberId;
  if (input.purpose) params.purpose = input.purpose;
  if (input.receiveSms !== undefined) params.receive_sms = String(input.receiveSms);
  if (input.period) params.period = input.period;
  if (input.autorenewPeriod) params.autorenew_period = input.autorenewPeriod;

  return (await request("/v1/direct_numbers/order/", params, "POST")) as ZadarmaOrderResult;
}

export type ZadarmaOwnedNumber = {
  number: string;
  status: string;
  country: string;
  description?: string;
  sip?: string;
  start_date?: string;
  stop_date?: string;
  monthly_fee: string;
  currency: string;
  channels?: number;
  autorenew?: boolean;
  type?: string;
};

/** GET /v1/direct_numbers/ — every number this Zadarma account owns, used
 * only for a periodic drift-check against our own zadarma_numbers table
 * (e.g. a number renewed/cancelled directly in Zadarma's dashboard, outside
 * this CRM) — never the source of truth for which company owns a number,
 * that's always our own database. */
export async function listOwnedNumbers(): Promise<ZadarmaOwnedNumber[]> {
  // Confirmed live (2026-11-10): wrapped under `info`, same pattern as
  // listCountries/listDestinations — not `numbers` as the docs implied.
  const data = (await request("/v1/direct_numbers/")) as { info?: ZadarmaOwnedNumber[] };
  return data.info ?? [];
}

/** PUT /v1/direct_numbers/set_sip_id/ — routes a purchased number to a
 * SIP/extension so it can actually place/receive calls. Not called during
 * Phase 1/2 of the onboarding flow (ordering ≠ routing); left as a function
 * here for when the buy flow or a later phase needs it. */
export async function setSipId(number: string, sipId: string): Promise<void> {
  await request("/v1/direct_numbers/set_sip_id/", { number, sip_id: sipId }, "PUT");
}

// ---------------------------------------------------------------------------
// PBX / SIP extension management — in-CRM equivalent of Zadarma's own PBX
// dashboard, scoped strictly to the endpoints their API reference actually
// documents (confirmed against https://zadarma.com/en/support/api/ on
// 2026-11-11). No endpoint exists to delete a PBX extension outright — see
// deleteExtensionCallerId's comment below for what "revoke" can and can't do.
// ---------------------------------------------------------------------------

/** Deliberate safety gate: every write call below (create/set-caller-id/
 * delete-caller-id) is real, chargeable-or-state-changing Zadarma API
 * activity, so each one refuses to run at all unless this env var is
 * explicitly "true". This is NOT a mock — when the gate is closed, the
 * function throws before any network request is built, so there is no
 * fabricated response, no fake SIP record, nothing to mistake for a real
 * one. Flipping this on is a deployment/config decision, never something
 * application code decides for itself. */
export function isLivePbxProvisioningEnabled(): boolean {
  return process.env.ZADARMA_LIVE_PBX_PROVISIONING === "true";
}

export class ZadarmaProvisioningDisabledError extends Error {
  constructor(action: string) {
    super(
      `Live Zadarma PBX provisioning is disabled (ZADARMA_LIVE_PBX_PROVISIONING is not "true") — refused to ${action}. This is a deliberate safety gate, not a bug or missing feature.`
    );
    this.name = "ZadarmaProvisioningDisabledError";
  }
}

function assertLivePbxProvisioningEnabled(action: string): void {
  if (!isLivePbxProvisioningEnabled()) {
    throw new ZadarmaProvisioningDisabledError(action);
  }
}

export type ZadarmaPbxExtensionList = { pbxId: number; numbers: number[] };

/** GET /v1/pbx/internal/ — read-only, free, never gated. Confirmed LIVE
 * against the real account (2026-11-11): returns a bare list of extension
 * NUMBERS only —
 * {status:"success", pbx_id: 588158, numbers: [100,101,102,103,104]} —
 * NOT richer per-extension objects. Those 5 numbers are Zadarma's own
 * pre-existing extensions, already on the account before this feature
 * existed; this function (and everything built on it) only ever reads that
 * list, never assumes anything about what those 5 numbers are for, and
 * never writes to them. Used for both the pre-provisioning extension-count/
 * cost check and the management-view status list. */
export async function listPbxExtensions(): Promise<ZadarmaPbxExtensionList> {
  const data = (await request("/v1/pbx/internal/")) as { pbx_id?: number; numbers?: number[] };
  return { pbxId: data.pbx_id ?? 0, numbers: data.numbers ?? [] };
}

export type ZadarmaPbxExtensionInfo = { sip: string; [key: string]: unknown };

/** GET /v1/pbx/internal/<SIP>/info/ — read-only, free, never gated. Per
 * Zadarma's docs returns extension details (name, caller ID, lines,
 * recording settings); exact field names are NOT yet verified against a
 * live response (doing so would mean querying one of the 5 pre-existing
 * extensions, which this feature deliberately never touches) — callers
 * must treat any field here as possibly absent, never fabricate one. */
export async function getPbxExtensionInfo(sip: string): Promise<ZadarmaPbxExtensionInfo> {
  return (await request(`/v1/pbx/internal/${encodeURIComponent(sip)}/info/`)) as ZadarmaPbxExtensionInfo;
}

export type ZadarmaCreatedExtension = { number: string; password?: string };

/** POST /v1/pbx/internal/create/ — real, potentially-chargeable (this
 * account is confirmed to already sit at Zadarma's 5-extension free-tier
 * allowance as of 2026-11-11; one more may incur a $2/month charge — see
 * the pre-flight limit check in zadarmaExtensionOnboarding.ts). Gated: never
 * reaches the network unless ZADARMA_LIVE_PBX_PROVISIONING="true". Response
 * shape here is per Zadarma's documented API only — NOT yet verified
 * against a live call, since making one is exactly what the gate exists to
 * prevent until explicitly approved. */
export async function createPbxExtension(params: { startNumber?: string; quantity?: number } = {}): Promise<ZadarmaCreatedExtension[]> {
  assertLivePbxProvisioningEnabled("create a PBX extension (POST /v1/pbx/internal/create/)");
  const body: Record<string, string> = { return_password: "true" };
  if (params.startNumber) body.start_number = params.startNumber;
  if (params.quantity) body.quantity = String(params.quantity);
  const data = (await request("/v1/pbx/internal/create/", body, "POST")) as { numbers?: ZadarmaCreatedExtension[] };
  return data.numbers ?? [];
}

/** PUT /v1/pbx/internal/<SIP>/callerid/ — sets this extension's outbound
 * Caller ID to one of the account's own purchased numbers. Gated — never
 * reaches the network unless live provisioning is explicitly enabled. */
export async function setExtensionCallerId(sip: string, number: string): Promise<void> {
  assertLivePbxProvisioningEnabled(`set Caller ID for extension ${sip}`);
  await request(`/v1/pbx/internal/${encodeURIComponent(sip)}/callerid/`, { number }, "PUT");
}

/** DELETE /v1/pbx/internal/<SIP>/callerid/ — removes an extension's Caller
 * ID. This is what "revoke" actually does on Zadarma's side: their
 * documented API (confirmed 2026-11-11 against the official reference) has
 * NO endpoint to delete a PBX extension outright — only create/list/info/
 * status/password/callerid/supervisor-mode are documented. So revoking an
 * extension in this CRM can only ever mean (a) clear its Caller ID here so
 * it stops dialing out as any company's number, and (b) mark it REVOKED in
 * our own database so the CRM stops issuing WebRTC keys or routing calls to
 * it. The extension itself keeps existing on the Zadarma account — fully
 * deleting it would require Zadarma's own dashboard or a support request.
 * Gated the same as every other write call here. */
export async function deleteExtensionCallerId(sip: string): Promise<void> {
  assertLivePbxProvisioningEnabled(`delete Caller ID for extension ${sip}`);
  await request(`/v1/pbx/internal/${encodeURIComponent(sip)}/callerid/`, {}, "DELETE");
}

export type ZadarmaWebrtcKey = { key: string; sip: string };

/** GET /v1/webrtc/get_key/ — mints the short-lived credential the browser
 * widget actually uses (never the account API key/secret, never the raw
 * SIP password). Docs state a 72h lifetime, but a real-world integration
 * (cited in Phase 0's research) found Zadarma can invalidate it earlier in
 * practice — callers should re-mint rather than cache this long-term, and
 * treat an auth rejection using a "fresh" one as a real signal, not a bug.
 *
 * Gated behind ZADARMA_LIVE_PBX_PROVISIONING, same as every other real PBX
 * write/credential call: minting a key is the one step that actually lets
 * a browser register as a live, call-capable SIP endpoint, which is exactly
 * what "keep live calling actions disabled until explicit approval" means
 * to block. In practice this is also naturally unreachable until an
 * extension has gone ACTIVE, which itself requires the same gate — two
 * independent reasons this can't do anything real while provisioning is
 * off, not just one. */
export async function getWebrtcKey(sip: string): Promise<ZadarmaWebrtcKey> {
  assertLivePbxProvisioningEnabled(`mint a WebRTC key for extension ${sip}`);
  const data = (await request("/v1/webrtc/get_key/", { sip })) as { key?: string };
  if (!data.key) throw new ZadarmaApiError("Zadarma's response didn't include a WebRTC key.");
  return { key: data.key, sip };
}

// ---------------------------------------------------------------------------
// Webhook signature verification — Zadarma's call-event notifications
// (POST /v1/pbx/callinfo/notifications/ configures which events get sent).
// Read-only by nature (verifying an inbound request, not calling Zadarma),
// so never gated by ZADARMA_LIVE_PBX_PROVISIONING.
// ---------------------------------------------------------------------------

export type ZadarmaWebhookEvent = "NOTIFY_START" | "NOTIFY_INTERNAL" | "NOTIFY_ANSWER" | "NOTIFY_END" | "NOTIFY_OUT_START" | "NOTIFY_OUT_END" | "NOTIFY_RECORD";

/** Builds the exact string Zadarma signs for a given event type. Derived
 * from Zadarma's own official PHP SDK source
 * (https://github.com/zadarma/user-api-v1) — NOT yet verified against a
 * live webhook delivery, since no real webhook subscription has been
 * registered on the account (that's a one-time Zadarma dashboard/API step,
 * separate from this code, and deliberately not done yet). Treat this as
 * "best evidence available," re-verify against the first real delivery
 * before relying on it in production, same discipline that caught three
 * separate real bugs in the list-endpoint response shapes earlier in this
 * project. Returns undefined for an event type with no known signature
 * construction — callers must reject rather than guess. */
function webhookSignatureString(event: string, fields: Record<string, string | undefined>): string | undefined {
  const f = (name: string) => fields[name] ?? "";
  switch (event) {
    case "NOTIFY_START":
    case "NOTIFY_INTERNAL":
    case "NOTIFY_END":
      return f("caller_id") + f("called_did") + f("call_start");
    case "NOTIFY_ANSWER":
      return f("caller_id") + f("destination") + f("call_start");
    case "NOTIFY_OUT_START":
    case "NOTIFY_OUT_END":
      return f("internal") + f("destination") + f("call_start");
    case "NOTIFY_RECORD":
      return f("pbx_call_id") + f("call_id_with_rec");
    default:
      return undefined;
  }
}

/** Verifies a webhook's `Signature` header: base64(hmac_sha1(secret,
 * signatureString)) — the same HMAC-SHA1-then-base64-of-hex primitive as
 * sign() above, confirmed against Zadarma's own SDK, just with a
 * per-event-type string to sign instead of the API-request one. Returns
 * false (never throws) for an unrecognized event type, a missing signature,
 * or a mismatch — callers must reject the request the same way in every
 * case, never revealing which reason applied. Uses a timing-safe
 * byte-length-checked comparison, same convention as
 * whatsapp.ts's verifyWebhookSecret. */
export function verifyWebhookSignature(event: string, fields: Record<string, string | undefined>, providedSignatureBase64: string | null): boolean {
  if (!providedSignatureBase64) return false;
  const { secret } = getCredentials();
  const toSign = webhookSignatureString(event, fields);
  if (toSign === undefined) return false;
  // Same construction as sign() above: HMAC-SHA1 as a hex string, then that
  // hex STRING (not the raw digest bytes) is base64-encoded — the same
  // Zadarma-specific quirk.
  const expectedHex = createHmac("sha1", secret).update(toSign).digest("hex");
  const expectedSignature = Buffer.from(expectedHex, "utf8").toString("base64");
  const expectedBuf = Buffer.from(expectedSignature, "utf8");
  const providedBuf = Buffer.from(providedSignatureBase64, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
