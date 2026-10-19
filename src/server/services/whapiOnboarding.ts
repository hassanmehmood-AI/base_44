import { randomBytes } from "node:crypto";
import * as companiesRepo from "@/server/repositories/companies";
import * as whapiChannelsRepo from "@/server/repositories/whapiChannels";
import type { WhapiChannel } from "@/server/repositories/whapiChannels";
import * as whapiProvider from "@/server/integrations/whapi";
import { WhapiApiError, WEBHOOK_SECRET_HEADER_NAME } from "@/server/integrations/whapi";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";
import { encryptSecret, decryptSecret, isEncryptionKeyConfigured } from "@/server/crypto/secretBox";
import { requireSession, UnauthorizedError } from "@/server/services/authorization";

/** WhatsApp (Whapi.Cloud) channel onboarding — the WhatsApp equivalent of
 * services/metricoolOnboarding.ts. On-demand only (never auto-provisioned on
 * company creation, per the explicit product requirement — a Whapi channel
 * is a real, continuously-billed resource, unlike a free Metricool brand).
 *
 * The one structural difference from Metricool's onboarding this file has to
 * handle that Metricool's didn't: createChannel is a PAID, non-idempotent
 * call with no provider-side idempotency key, so the insert-first/unique-
 * index/state-machine design below (see db/schema.ts's whapiChannels and
 * repositories/whapiChannels.ts) is what stands in for one — see
 * createChannelForCompany's doc comment. */

async function assertSuperuser() {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") {
    throw new UnauthorizedError("Only Superusers can manage WhatsApp (Whapi) channels.");
  }
  return session;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505";
}

/** A create-channel failure is "ambiguous" (might have actually created a
 * paid channel on Whapi's side before the response was lost) unless it's a
 * clean, documented client-error rejection from Whapi itself — a 4xx means
 * Whapi looked at the request and refused it before provisioning anything.
 * Everything else (5xx after retries exhausted, a thrown network/timeout
 * error) is treated as ambiguous and routed to FAILED_NEEDS_MANUAL_CHECK
 * rather than an auto-retryable FAILED — see whapiChannelsRepo.markFailed's
 * doc comment and the non-idempotent-send caution already applied to
 * Metricool's sendMessage retry policy in integrations/metricool.ts. */
/** Exported only so the regression tests (whapiOnboarding.test.ts) can
 * exercise this classification directly without a database — same idiom as
 * social.ts's exported pure sync helpers. */
export function isAmbiguousFailure(e: unknown): boolean {
  if (e instanceof WhapiApiError) return e.status >= 500;
  return true;
}

function webhookUrl(): string {
  const base = process.env.CRM_BASE_URL;
  if (!base) throw new ProviderNotConfiguredError("Whapi", ["CRM_BASE_URL"]);
  return `${base.replace(/\/$/, "")}/api/webhooks/whapi`;
}

export type ProvisionResult =
  | { ok: true; channelId: string }
  | {
      ok: false;
      reason: "not_configured" | "already_provisioning_or_provisioned" | "needs_manual_check" | "not_eligible_for_retry" | "error";
      message: string;
    };

/** Performs the actual Whapi create + webhook-registration + encrypted
 * storage for an already-claimed PENDING row. Shared by both
 * createChannelForCompany (a fresh row) and retryChannelCreation (a row
 * reclaimed from FAILED) so the paid-call/failure-classification logic
 * exists in exactly one place. */
async function provisionClaimedRow(row: WhapiChannel, companyName: string): Promise<ProvisionResult> {
  try {
    const created = await whapiProvider.createChannel(companyName);
    const webhookSecret = randomBytes(32).toString("hex");

    // Registering the webhook happens before we persist anything as ACTIVE —
    // if this step fails, the channel undeniably exists on Whapi's side
    // (createChannel already succeeded), so this is always a "needs manual
    // check" outcome, never a plain retryable FAILED (a retry would create a
    // SECOND paid channel for the same company, since the first one is real
    // and already running, just not receiving inbound messages yet).
    try {
      await whapiProvider.setWebhook(created.apiUrl, created.token, webhookUrl(), WEBHOOK_SECRET_HEADER_NAME, webhookSecret);
    } catch (webhookError) {
      const message = webhookError instanceof Error ? webhookError.message : "Unknown error registering the webhook.";
      // The channel itself was created successfully (it's real and billable)
      // — its id/apiUrl/token are persisted here (not discarded) specifically
      // so this isn't orphaned/untracked data, even though this row can't be
      // marked ACTIVE until the webhook is actually working.
      await whapiChannelsRepo.markNeedsManualCheck(row.id, {
        channelId: created.id,
        apiUrl: created.apiUrl,
        encryptedToken: encryptSecret(created.token),
        lastError: `Channel ${created.id} was created on Whapi but webhook registration failed: ${message}. The channel already exists and is billable — do not retry channel creation; fix the webhook via Whapi's settings endpoint or contact Whapi support, then mark this resolved.`,
      });
      return {
        ok: false,
        reason: "needs_manual_check",
        message: "The Whapi channel was created, but registering its webhook failed. A Superuser must check the Whapi dashboard before any further action — retrying here would create a second paid channel.",
      };
    }

    await whapiChannelsRepo.markActive(row.id, {
      channelId: created.id,
      apiUrl: created.apiUrl,
      encryptedToken: encryptSecret(created.token),
      encryptedWebhookSecret: encryptSecret(webhookSecret),
    });
    return { ok: true, channelId: created.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error creating the Whapi channel.";
    if (isAmbiguousFailure(e)) {
      await whapiChannelsRepo.markFailed(
        row.id,
        "FAILED_NEEDS_MANUAL_CHECK",
        `Ambiguous failure (possibly created on Whapi's side): ${message}`
      );
      return {
        ok: false,
        reason: "needs_manual_check",
        message: "Whapi's response was inconclusive (timeout or server error) — it's unknown whether a paid channel was actually created. Check the Whapi partner dashboard for a channel matching this company before retrying.",
      };
    }
    await whapiChannelsRepo.markFailed(row.id, "FAILED", message);
    return { ok: false, reason: "error", message };
  }
}

/** On-demand only — called from a Configuración button click, never from
 * company creation (see companies.ts's createCompany, which is deliberately
 * NOT touched by this file, unlike Metricool's autoProvisionMetricoolBrand).
 *
 * Duplicate-paid-channel guard: insertPending is attempted FIRST, before any
 * Whapi call — the unique index on whapi_channels.companyId means a
 * double-click, a browser-retried slow request, or two Superusers acting on
 * the same company at once can only ever have one attempt win that insert.
 * Every other concurrent/duplicate attempt gets a unique-violation here and
 * returns immediately, never reaching the paid createChannel call below. */
export async function createChannelForCompany(companyId: string): Promise<ProvisionResult> {
  await assertSuperuser();

  if (!whapiProvider.isWhapiPartnerConfigured()) {
    return { ok: false, reason: "not_configured", message: "Whapi is not configured yet (missing WHAPI_PARTNER_TOKEN/WHAPI_PROJECT_ID)." };
  }
  if (!isEncryptionKeyConfigured()) {
    return { ok: false, reason: "not_configured", message: "WHAPI_TOKEN_ENCRYPTION_KEY is not configured — cannot safely store a channel token." };
  }

  const company = await companiesRepo.findById(companyId);
  if (!company) throw new Error("Company not found.");

  let row: WhapiChannel;
  try {
    row = await whapiChannelsRepo.insertPending(companyId);
  } catch (e) {
    if (isUniqueViolation(e)) {
      return {
        ok: false,
        reason: "already_provisioning_or_provisioned",
        message: "This company already has a WhatsApp channel (or one is already being created) — no new channel was created.",
      };
    }
    throw e;
  }

  return provisionClaimedRow(row, company.name);
}

/** Manual retry for a company whose channel creation previously failed
 * cleanly (status FAILED, never FAILED_NEEDS_MANUAL_CHECK — see
 * confirmNoChannelWasCreated). claimForRetry's conditional UPDATE is the
 * same race-closer as insertPending above: only one concurrent retry click
 * can ever win it. */
export async function retryChannelCreation(companyId: string): Promise<ProvisionResult> {
  await assertSuperuser();
  const company = await companiesRepo.findById(companyId);
  if (!company) throw new Error("Company not found.");

  const row = await whapiChannelsRepo.claimForRetry(companyId);
  if (!row) {
    return {
      ok: false,
      reason: "not_eligible_for_retry",
      message: "No retryable channel found for this company — it may already be active, still being created, or waiting on a manual check.",
    };
  }
  return provisionClaimedRow(row, company.name);
}

/** The explicit, human action that unblocks retrying after an ambiguous
 * failure — a Superuser confirms (by checking Whapi's own partner
 * dashboard) that no paid channel actually exists for this company yet.
 * Never called automatically. */
export async function confirmNoChannelWasCreated(companyId: string): Promise<{ ok: boolean; message: string }> {
  await assertSuperuser();
  const row = await whapiChannelsRepo.acknowledgeManualCheck(companyId);
  if (!row) {
    return { ok: false, message: "No channel awaiting manual confirmation was found for this company." };
  }
  return { ok: true, message: "Acknowledged — this company's channel can now be retried." };
}

export type CompanyChannelStatus = {
  companyId: string;
  status: "NONE" | "PENDING" | "ACTIVE" | "FAILED" | "FAILED_NEEDS_MANUAL_CHECK";
};

/** DB-only (no Whapi call) — safe for every Configuración page load, same
 * role as metricoolOnboarding's getProvisioningStatusForCompanies. Never
 * returns the encrypted token or webhook secret. */
export async function getProvisioningStatusForCompanies(companyIds: string[]): Promise<CompanyChannelStatus[]> {
  await assertSuperuser();
  const rows = await whapiChannelsRepo.findByCompanyIds(companyIds);
  return companyIds.map((companyId) => {
    const row = rows.find((r) => r.companyId === companyId);
    return { companyId, status: (row?.status as CompanyChannelStatus["status"]) ?? "NONE" };
  });
}

export type LiveChannelStatus =
  | { provisioned: false }
  | { provisioned: true; connected: boolean; statusText: string; phone: string | null }
  | { provisioned: true; error: string };

/** Live Whapi call — only on-demand (a "Check status" button), mirroring
 * metricoolOnboarding's getLiveConnectionStatus. Decrypts the stored token
 * only in-memory, for this one outbound call — never returned to the
 * caller/browser. */
export async function getLiveChannelStatus(companyId: string): Promise<LiveChannelStatus> {
  await assertSuperuser();
  const row = await whapiChannelsRepo.findByCompanyId(companyId);
  if (!row || row.status !== "ACTIVE" || !row.apiUrl || !row.encryptedToken) return { provisioned: false };

  try {
    const token = decryptSecret(row.encryptedToken);
    const health = await whapiProvider.getChannelHealth(row.apiUrl, token);
    return { provisioned: true, connected: health.connected, statusText: health.statusText, phone: health.phone };
  } catch (e) {
    const message = e instanceof ProviderNotConfiguredError || e instanceof Error ? e.message : "Unknown error.";
    return { provisioned: true, error: message };
  }
}

export type QrResult = { ok: true; status: string; base64: string | null } | { ok: false; message: string };

/** Live Whapi call, only on-demand from the "Connect WhatsApp" button in
 * Configuración. Returns just the QR image for the browser to render — the
 * decrypted channel token never leaves this function. */
export async function getQrForCompany(companyId: string): Promise<QrResult> {
  await assertSuperuser();
  const row = await whapiChannelsRepo.findByCompanyId(companyId);
  if (!row || row.status !== "ACTIVE" || !row.apiUrl || !row.encryptedToken) {
    return { ok: false, message: "This company has no active WhatsApp channel yet." };
  }
  try {
    const token = decryptSecret(row.encryptedToken);
    const qr = await whapiProvider.getQrCode(row.apiUrl, token);
    return { ok: true, status: qr.status, base64: qr.base64 };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error fetching the QR code.";
    return { ok: false, message };
  }
}
