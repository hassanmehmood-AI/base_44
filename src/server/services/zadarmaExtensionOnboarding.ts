import * as companiesRepo from "@/server/repositories/companies";
import * as usersRepo from "@/server/repositories/users";
import * as zadarmaExtensionsRepo from "@/server/repositories/zadarmaExtensions";
import type { ZadarmaExtension } from "@/server/repositories/zadarmaExtensions";
import * as zadarmaNumbersRepo from "@/server/repositories/zadarmaNumbers";
import * as zadarmaProvider from "@/server/integrations/zadarma";
import { requireSession, UnauthorizedError } from "@/server/services/authorization";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";
import * as zadarmaSecretBox from "@/server/crypto/zadarmaSecretBox";

/** SIP/PBX extension management — the in-CRM replacement for manually
 * creating/assigning extensions in Zadarma's own dashboard. Structurally
 * mirrors zadarmaNumberOnboarding.ts (same PENDING-first/unique-index/
 * state-machine design, same typed-error classification), because
 * POST /v1/pbx/internal/create/ is the same kind of paid, non-idempotent
 * call as order/ for numbers.
 *
 * Every real write (create / set-caller-id / delete-caller-id) runs through
 * zadarma.ts's functions, each of which refuses to touch the network unless
 * ZADARMA_LIVE_PBX_PROVISIONING="true" (see zadarma.ts's
 * assertLivePbxProvisioningEnabled). That gate is off by default — this
 * service calls the REAL functions either way, it never has a separate
 * "mock mode" of its own. With the gate off, createExtensionForAgent still
 * inserts a PENDING row, still calls the real createPbxExtension(), and
 * that real call throws ZadarmaProvisioningDisabledError before any network
 * request is built — which this service surfaces as a clear
 * "provisioning_disabled" result, then marks the row FAILED (a clean,
 * understood, safely-retryable rejection, never ambiguous) rather than
 * leaving a dangling PENDING row. */

async function assertSuperuser() {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") {
    throw new UnauthorizedError("Only Superusers can manage Zadarma SIP extensions.");
  }
  return session;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505";
}

/** Same classification as zadarmaNumberOnboarding.ts's isAmbiguousFailure:
 * a clean, understood rejection FROM Zadarma (auth/rate-limit/API error, or
 * our own provisioning-disabled gate) means Zadarma never actually ran the
 * request — safely retryable (FAILED). Only a genuine network-level
 * failure, where no real response ever arrived, is ambiguous
 * (FAILED_NEEDS_MANUAL_CHECK) — exported so tests can exercise it directly,
 * same idiom as whapiOnboarding.test.ts / zadarmaNumberOnboarding.ts. */
export function isAmbiguousFailure(e: unknown): boolean {
  if (e instanceof zadarmaProvider.ZadarmaProvisioningDisabledError) return false;
  if (e instanceof zadarmaProvider.ZadarmaAuthError) return false;
  if (e instanceof zadarmaProvider.ZadarmaRateLimitError) return false;
  if (e instanceof zadarmaProvider.ZadarmaApiError) return false;
  return true;
}

export type ZadarmaExtensionErrorReason =
  | "not_configured"
  | "unauthorized"
  | "provisioning_disabled"
  | "auth"
  | "rate_limit"
  | "network"
  | "error";

export function classifyError(e: unknown): { reason: ZadarmaExtensionErrorReason; message: string } {
  if (e instanceof ProviderNotConfiguredError) return { reason: "not_configured", message: e.message };
  if (e instanceof UnauthorizedError) return { reason: "unauthorized", message: "Only Superusers can manage Zadarma SIP extensions." };
  if (e instanceof zadarmaProvider.ZadarmaProvisioningDisabledError) return { reason: "provisioning_disabled", message: e.message };
  if (e instanceof zadarmaProvider.ZadarmaAuthError) return { reason: "auth", message: e.message };
  if (e instanceof zadarmaProvider.ZadarmaRateLimitError) return { reason: "rate_limit", message: e.message };
  if (e instanceof zadarmaProvider.ZadarmaNetworkError) return { reason: "network", message: e.message };
  if (e instanceof Error) return { reason: "error", message: e.message };
  return { reason: "error", message: "Unknown error." };
}

// ---------------------------------------------------------------------------
// Read-only — safe to call freely, no cost.
// ---------------------------------------------------------------------------

export type ExtensionLimitCheck = {
  liveProvisioningEnabled: boolean;
  existingExtensionCount: number;
  existingExtensionNumbers: number[];
};

/** Pre-flight check shown to the Superuser BEFORE the create button is even
 * enabled (requirement #10/#11). Calls the real, free, read-only
 * listPbxExtensions() — this is the live count, not a guess. Zadarma
 * documents a free-plan allowance (commonly 5) but exposes no "limit
 * remaining" field, so this deliberately shows the live count and lets the
 * Superuser judge against their own known plan tier rather than asserting a
 * number this code can't actually confirm. */
export async function checkExtensionLimits(): Promise<ExtensionLimitCheck> {
  await assertSuperuser();
  if (!zadarmaProvider.isZadarmaConfigured()) {
    return { liveProvisioningEnabled: false, existingExtensionCount: 0, existingExtensionNumbers: [] };
  }
  const { numbers } = await zadarmaProvider.listPbxExtensions();
  return {
    liveProvisioningEnabled: zadarmaProvider.isLivePbxProvisioningEnabled(),
    existingExtensionCount: numbers.length,
    existingExtensionNumbers: numbers,
  };
}

export async function listExtensions(): Promise<ZadarmaExtension[]> {
  await assertSuperuser();
  return zadarmaExtensionsRepo.findAll();
}

/** DB-only status per company, for the Configuración management table —
 * same role as zadarmaNumberOnboarding's getProvisioningStatusForCompanies. */
export async function getExtensionsForCompanies(companyIds: string[]): Promise<ZadarmaExtension[]> {
  await assertSuperuser();
  return zadarmaExtensionsRepo.findByCompanyIds(companyIds);
}

/** The agent picker's data source — reuses the exact same "active,
 * non-Superuser users with access to this company" list already used
 * elsewhere in the app (assignment dropdowns), so the UI never shows an
 * agent who doesn't actually belong to the selected company. */
export async function getAssignableAgents(companyId: string) {
  await assertSuperuser();
  return usersRepo.findAssignableForCompany(companyId);
}

/** Best-effort extraction of a Caller ID from getPbxExtensionInfo()'s
 * response — its exact field names are NOT confirmed live (see zadarma.ts's
 * ZadarmaPbxExtensionInfo comment), so this tries the handful of plausible
 * names Zadarma's docs/API reference suggest and returns null rather than
 * fabricating one if none of them are present. Exported only so tests can
 * exercise it directly, same idiom as this file's classifyError. */
export function extractCallerId(info: zadarmaProvider.ZadarmaPbxExtensionInfo): string | null {
  for (const key of ["caller_id", "callerid", "callerId", "caller_id_number"]) {
    const value = info[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Write — real provisioning, gated by zadarma.ts's
// ZADARMA_LIVE_PBX_PROVISIONING (see this file's module comment).
// ---------------------------------------------------------------------------

export type ConnectExistingExtensionResult =
  | { ok: true; sipExtension: string; callerIdNumber: string | null; callerIdMismatch: boolean }
  | {
      ok: false;
      reason: "not_configured" | "already_linked" | "already_has_extension" | "not_found_on_account" | "no_number" | ZadarmaExtensionErrorReason;
      message: string;
    };

/** "Add Existing SIP" — Feature 1. Never calls any real write endpoint
 * (no create, no setExtensionCallerId, no password change): it only reads
 * (to verify) and writes to this CRM's own database. Caller ID is recorded
 * exactly as Zadarma reports it right now — never forced to match the
 * company, per the explicit "never silently modify a mismatched Caller ID"
 * instruction. A mismatch is surfaced in the result, not corrected. */
export async function connectExistingExtension(input: {
  companyId: string;
  userId: string;
  sipExtension: string;
  sipPassword: string;
}): Promise<ConnectExistingExtensionResult> {
  const session = await assertSuperuser();

  if (!zadarmaProvider.isZadarmaConfigured()) {
    return { ok: false, reason: "not_configured", message: "Zadarma is not configured yet (missing ZADARMA_API_KEY/ZADARMA_API_SECRET)." };
  }

  const company = await companiesRepo.findById(input.companyId);
  if (!company) throw new Error("Company not found.");

  // Defense in depth — same re-check as createExtensionForAgent, never
  // trusts that the client-side picker's own filtering was respected.
  const assignable = await usersRepo.findAssignableForCompany(input.companyId);
  if (!assignable.some((u) => u.id === input.userId)) {
    throw new UnauthorizedError("This user is not an assignable agent for the selected company.");
  }

  // Friendly pre-checks before touching the database — the real guarantee
  // is still the unique indexes below, these just give a clearer reason
  // than a raw unique-violation would.
  const alreadyLinked = await zadarmaExtensionsRepo.findBySipExtension(input.sipExtension);
  if (alreadyLinked) {
    return { ok: false, reason: "already_linked", message: `Extension ${input.sipExtension} is already linked in this CRM (status: ${alreadyLinked.status}).` };
  }
  const agentExisting = await zadarmaExtensionsRepo.findActiveOrPendingByUserId(input.userId);
  if (agentExisting) {
    return { ok: false, reason: "already_has_extension", message: "This agent already has an extension in progress or active — one agent can only hold one." };
  }

  // Verify the extension genuinely exists on the real, connected Zadarma
  // account BEFORE ever saving anything — never trust a typed-in number.
  let verified: { numbers: number[] };
  try {
    verified = await zadarmaProvider.listPbxExtensions();
  } catch (e) {
    const { reason, message } = classifyError(e);
    return { ok: false, reason, message };
  }
  if (!verified.numbers.some((n) => String(n) === input.sipExtension)) {
    return { ok: false, reason: "not_found_on_account", message: `Extension ${input.sipExtension} was not found among this Zadarma account's real extensions.` };
  }

  // Best-effort: fetch its current info/Caller ID for display — a failure
  // here never blocks linking (the extension's existence is already
  // confirmed above via the list call), it just means the Caller ID shows
  // as unknown rather than a specific value.
  let callerIdNumber: string | null = null;
  try {
    const info = await zadarmaProvider.getPbxExtensionInfo(input.sipExtension);
    callerIdNumber = extractCallerId(info);
  } catch {
    callerIdNumber = null;
  }

  const activeNumber = await zadarmaNumbersRepo.findActiveByCompanyId(input.companyId);
  const callerIdMismatch = callerIdNumber !== null && callerIdNumber !== (activeNumber?.number ?? null);

  const sipPasswordEncrypted = zadarmaSecretBox.encryptSecret(input.sipPassword);

  try {
    const row = await zadarmaExtensionsRepo.insertExisting({
      companyId: input.companyId,
      userId: input.userId,
      sipExtension: input.sipExtension,
      sipPasswordEncrypted,
      callerIdNumber,
      createdBy: session.user.id,
    });
    return { ok: true, sipExtension: row.sipExtension as string, callerIdNumber, callerIdMismatch };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { ok: false, reason: "already_linked", message: "This extension or agent was linked by another request just now — no duplicate was created." };
    }
    throw e;
  }
}

export type CreateExtensionResult =
  | { ok: true; sipExtension: string }
  | {
      ok: false;
      reason: "not_configured" | "already_exists" | "provisioning_disabled" | "needs_manual_check" | "no_number" | "error";
      message: string;
    };

/** Performs the real create + Caller ID call for an already-claimed PENDING
 * row. Shared by createExtensionForAgent (a fresh row) and retryCreate (a
 * row reclaimed from FAILED) — mirrors zadarmaNumberOnboarding.ts's
 * provisionClaimedRow precisely. */
async function provisionClaimedRow(row: ZadarmaExtension, company: { id: string }): Promise<CreateExtensionResult> {
  const activeNumber = await zadarmaNumbersRepo.findActiveByCompanyId(company.id);
  if (!activeNumber?.number) {
    await zadarmaExtensionsRepo.markFailed(row.id, "FAILED", "This company has no active Zadarma number to assign as Caller ID yet.");
    return { ok: false, reason: "no_number", message: "This company has no active Zadarma number yet — buy/assign one before creating an extension for its agents." };
  }

  try {
    const created = await zadarmaProvider.createPbxExtension({ quantity: 1 });
    const extension = created[0];
    if (!extension?.number) {
      await zadarmaExtensionsRepo.markFailed(row.id, "FAILED_NEEDS_MANUAL_CHECK", "Zadarma's create response didn't clearly confirm a new extension number — check the Zadarma dashboard before retrying.");
      return { ok: false, reason: "needs_manual_check", message: "Zadarma's response didn't clearly confirm a new extension. Check the Zadarma dashboard before retrying — do not create again." };
    }

    await zadarmaProvider.setExtensionCallerId(extension.number, activeNumber.number);

    const sipPasswordEncrypted = extension.password ? zadarmaSecretBox.encryptSecret(extension.password) : null;
    await zadarmaExtensionsRepo.markActive(row.id, {
      sipExtension: extension.number,
      sipPasswordEncrypted,
      callerIdNumber: activeNumber.number,
    });
    return { ok: true, sipExtension: extension.number };
  } catch (e) {
    const { reason, message } = classifyError(e);
    if (reason === "provisioning_disabled") {
      // A clean, understood refusal from our own gate — exactly what
      // isAmbiguousFailure(e) below would also conclude, spelled out here
      // for clarity: nothing was ever sent to Zadarma, so FAILED (safely
      // retryable once the gate is enabled), never FAILED_NEEDS_MANUAL_CHECK.
      await zadarmaExtensionsRepo.markFailed(row.id, "FAILED", message);
      return { ok: false, reason: "provisioning_disabled", message };
    }
    if (isAmbiguousFailure(e)) {
      await zadarmaExtensionsRepo.markFailed(row.id, "FAILED_NEEDS_MANUAL_CHECK", `Ambiguous failure (possibly created on Zadarma's side): ${message}`);
      return {
        ok: false,
        reason: "needs_manual_check",
        message: "Zadarma's response was inconclusive (timeout or network error) — it's unknown whether an extension was actually created. Check the Zadarma dashboard for an unexpected extension/charge before retrying.",
      };
    }
    await zadarmaExtensionsRepo.markFailed(row.id, "FAILED", message);
    return { ok: false, reason: "error", message };
  }
}

/** The one entry point that can trigger a real, potentially-chargeable
 * Zadarma write. Duplicate-creation guard: insertPending is attempted
 * FIRST, before any Zadarma call — the partial unique index on
 * zadarma_extensions (userId WHERE status IN ('PENDING','ACTIVE')) means a
 * double-click or two Superusers provisioning for the same agent at once
 * can only ever have one attempt win that insert. */
export async function createExtensionForAgent(input: { companyId: string; userId: string }): Promise<CreateExtensionResult> {
  const session = await assertSuperuser();

  if (!zadarmaProvider.isZadarmaConfigured()) {
    return { ok: false, reason: "not_configured", message: "Zadarma is not configured yet (missing ZADARMA_API_KEY/ZADARMA_API_SECRET)." };
  }

  const company = await companiesRepo.findById(input.companyId);
  if (!company) throw new Error("Company not found.");

  // Defense in depth: never trust that the agent picker's own filtering was
  // respected client-side — re-check server-side that this user actually
  // belongs to this company before creating anything for them.
  const assignable = await usersRepo.findAssignableForCompany(input.companyId);
  if (!assignable.some((u) => u.id === input.userId)) {
    throw new UnauthorizedError("This user is not an assignable agent for the selected company.");
  }

  let row: ZadarmaExtension;
  try {
    row = await zadarmaExtensionsRepo.insertPending({ companyId: input.companyId, userId: input.userId, createdBy: session.user.id });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { ok: false, reason: "already_exists", message: "This agent already has an extension in progress or active — no new one was created." };
    }
    throw e;
  }

  return provisionClaimedRow(row, company);
}

/** Manual retry for a create that previously failed cleanly (status FAILED,
 * never FAILED_NEEDS_MANUAL_CHECK — see confirmNoChargeOccurred). */
export async function retryCreateExtension(extensionRowId: string): Promise<CreateExtensionResult> {
  await assertSuperuser();
  const row = await zadarmaExtensionsRepo.claimForRetry(extensionRowId);
  if (!row || !row.companyId) {
    return { ok: false, reason: "error", message: "No retryable extension found — it may already be active, still in progress, or waiting on a manual check." };
  }
  const company = await companiesRepo.findById(row.companyId);
  if (!company) {
    return { ok: false, reason: "error", message: "This extension's company no longer exists." };
  }
  return provisionClaimedRow(row, company);
}

/** The explicit, human action that unblocks retrying after an ambiguous
 * failure — a Superuser confirms (by checking Zadarma's own dashboard) that
 * no extension was actually created for this attempt. Never automatic. */
export async function confirmNoExtensionChargeOccurred(extensionRowId: string): Promise<{ ok: boolean; message: string }> {
  await assertSuperuser();
  const row = await zadarmaExtensionsRepo.acknowledgeManualCheck(extensionRowId);
  if (!row) {
    return { ok: false, message: "No extension creation awaiting manual confirmation was found." };
  }
  return { ok: true, message: "Acknowledged — this extension can now be retried." };
}

export type ReassignResult = { ok: true } | { ok: false; reason: ZadarmaExtensionErrorReason | "no_number"; message: string };

/** Moves an ACTIVE extension to a different agent/company, including
 * updating its real Caller ID to the new company's number. Requires its own
 * explicit Superuser confirmation at the UI layer before this is called —
 * see requirement #14. */
export async function reassignExtension(extensionRowId: string, newCompanyId: string, newUserId: string): Promise<ReassignResult> {
  await assertSuperuser();

  const company = await companiesRepo.findById(newCompanyId);
  if (!company) throw new Error("Company not found.");
  const assignable = await usersRepo.findAssignableForCompany(newCompanyId);
  if (!assignable.some((u) => u.id === newUserId)) {
    throw new UnauthorizedError("This user is not an assignable agent for the selected company.");
  }

  const current = await zadarmaExtensionsRepo.findById(extensionRowId);
  if (!current || current.status !== "ACTIVE" || !current.sipExtension) {
    return { ok: false, reason: "error", message: "Extension not found, or it isn't an active provisioned extension." };
  }

  const activeNumber = await zadarmaNumbersRepo.findActiveByCompanyId(newCompanyId);
  if (!activeNumber?.number) {
    return { ok: false, reason: "no_number", message: "The destination company has no active Zadarma number yet." };
  }

  try {
    await zadarmaProvider.setExtensionCallerId(current.sipExtension, activeNumber.number);
  } catch (e) {
    const { reason, message } = classifyError(e);
    return { ok: false, reason, message };
  }

  const row = await zadarmaExtensionsRepo.reassign(extensionRowId, newCompanyId, newUserId, activeNumber.number);
  if (!row) return { ok: false, reason: "error", message: "Reassignment failed to save." };
  return { ok: true };
}

export type RevokeResult = { ok: true } | { ok: false; reason: ZadarmaExtensionErrorReason; message: string };

/** Revokes an ACTIVE extension — see deleteExtensionCallerId's comment in
 * zadarma.ts for exactly what this can and can't do against the real
 * Zadarma account (there is no "delete extension" API; this clears its
 * Caller ID and marks it REVOKED here, which is what actually stops the CRM
 * from using it). Requires its own explicit Superuser confirmation at the
 * UI layer — see requirement #14. */
export async function revokeExtension(extensionRowId: string): Promise<RevokeResult> {
  await assertSuperuser();
  const current = await zadarmaExtensionsRepo.findById(extensionRowId);
  if (!current || current.status !== "ACTIVE" || !current.sipExtension) {
    return { ok: false, reason: "error", message: "Extension not found, or it isn't an active provisioned extension." };
  }

  try {
    await zadarmaProvider.deleteExtensionCallerId(current.sipExtension);
  } catch (e) {
    const { reason, message } = classifyError(e);
    return { ok: false, reason, message };
  }

  const row = await zadarmaExtensionsRepo.markRevoked(extensionRowId);
  if (!row) return { ok: false, reason: "error", message: "Revoke failed to save." };
  return { ok: true };
}
