import * as companiesRepo from "@/server/repositories/companies";
import * as zadarmaNumbersRepo from "@/server/repositories/zadarmaNumbers";
import type { ZadarmaNumber } from "@/server/repositories/zadarmaNumbers";
import * as zadarmaProvider from "@/server/integrations/zadarma";
import { requireSession, UnauthorizedError } from "@/server/services/authorization";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";

/** Zadarma virtual-number purchasing — the paid-provisioning equivalent of
 * whapiOnboarding.ts, for buying/assigning calling numbers instead of
 * WhatsApp channels. One shared Zadarma account (ZADARMA_API_KEY/SECRET,
 * unchanged, see zadarma.ts) owns every number; this file is what lets a
 * Superuser buy one and assign it to a specific company, directly from
 * Configuración, instead of provisioning numbers manually in Zadarma's own
 * dashboard.
 *
 * Same structural reason whapiOnboarding.ts exists for channels: order/ is a
 * PAID, non-idempotent call with no provider-side idempotency key, so the
 * insert-first/unique-index/state-machine design below (see db/schema.ts's
 * zadarmaNumbers and repositories/zadarmaNumbers.ts) stands in for one. */

async function assertSuperuser() {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") {
    throw new UnauthorizedError("Only Superusers can buy or manage Zadarma numbers.");
  }
  return session;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505";
}

/** An order failure is "ambiguous" (might have actually purchased a number
 * on Zadarma's side before the response was lost) unless it's a response
 * Zadarma itself returned with a clean, parseable error body — that means
 * Zadarma looked at the request and rejected it before charging anything.
 * A thrown error with no parseable Zadarma response (network failure,
 * timeout, non-JSON body) is treated as ambiguous and routed to
 * FAILED_NEEDS_MANUAL_CHECK — same "never auto-retry a maybe-already-paid
 * call" caution as whapiOnboarding.ts's isAmbiguousFailure. Exported only so
 * tests can exercise this classification directly, same idiom as
 * whapiOnboarding.test.ts. */
export function isAmbiguousFailure(e: unknown): boolean {
  // zadarma.ts's request() now throws one of four typed errors (see its own
  // module comment) instead of a single generic Error — ZadarmaAuthError/
  // ZadarmaRateLimitError/ZadarmaApiError all mean Zadarma definitely
  // received and responded to the request (a clean, understood rejection),
  // so none of those are ambiguous. Only ZadarmaNetworkError — no real
  // response ever arrived — leaves it genuinely unknown whether the order
  // reached Zadarma at all.
  if (e instanceof zadarmaProvider.ZadarmaAuthError) return false;
  if (e instanceof zadarmaProvider.ZadarmaRateLimitError) return false;
  if (e instanceof zadarmaProvider.ZadarmaApiError) return false;
  return true;
}

export type ZadarmaErrorReason = "not_configured" | "unauthorized" | "auth" | "rate_limit" | "network" | "error";

/** Turns any error this file's functions can throw into a UI-friendly
 * {reason, message} pair — see zadarma.ts's error classes for what each
 * reason actually represents. Used by the Configuración actions layer so
 * the Buy Zadarma Number wizard can distinguish "Zadarma rejected your
 * credentials" from "Zadarma is rate-limiting you" from "no network" from
 * a plain unexpected error, and decide whether a Retry button makes sense
 * (it doesn't for not_configured/unauthorized, but does for the other
 * three — see the wizard's own use of this). */
export function classifyError(e: unknown): { reason: ZadarmaErrorReason; message: string } {
  if (e instanceof ProviderNotConfiguredError) return { reason: "not_configured", message: e.message };
  if (e instanceof UnauthorizedError) return { reason: "unauthorized", message: "Only Superusers can manage Zadarma numbers." };
  if (e instanceof zadarmaProvider.ZadarmaAuthError) return { reason: "auth", message: e.message };
  if (e instanceof zadarmaProvider.ZadarmaRateLimitError) return { reason: "rate_limit", message: e.message };
  if (e instanceof zadarmaProvider.ZadarmaNetworkError) return { reason: "network", message: e.message };
  if (e instanceof Error) return { reason: "error", message: e.message };
  return { reason: "error", message: "Unknown error." };
}

// ---------------------------------------------------------------------------
// Read-only — safe to call freely, no cost, no Superuser gate needed beyond
// the normal authenticated-session requirement (matches how the rest of this
// app treats read access to provider metadata).
// ---------------------------------------------------------------------------

export async function getCountries() {
  await assertSuperuser();
  return zadarmaProvider.listCountries();
}

export async function getDestinations(countryCodeIso: string) {
  await assertSuperuser();
  return zadarmaProvider.listDestinations(countryCodeIso);
}

export async function searchAvailableNumbers(directionId: string, mask?: string) {
  await assertSuperuser();
  return zadarmaProvider.listAvailableNumbers(directionId, mask);
}

export async function getDocumentGroups() {
  await assertSuperuser();
  return zadarmaProvider.listDocumentGroups();
}

export async function getDocumentCheckErrors(groupId: string) {
  await assertSuperuser();
  return zadarmaProvider.getDocumentCheckErrors(groupId);
}

export type BalanceCheckResult =
  | { ok: true; balance: string; currency: string }
  | { ok: false; reason: "not_configured" | "insufficient" | "error"; message: string };

/** Best-effort pre-purchase funds check — compares the account balance
 * against the destination's own connect_fee + monthly_fee. Deliberately
 * does NOT block the actual order/ call from its own authority: Zadarma's
 * balance can change between this check and the purchase click, so a real
 * insufficient-funds rejection from order/ itself is still handled
 * separately in purchaseNumber below. This only lets the UI warn the
 * Superuser *before* they even reach the confirm step. */
export async function checkSufficientBalance(destination: { connect_fee: string; monthly_fee: string; currency: string }): Promise<BalanceCheckResult> {
  await assertSuperuser();
  if (!zadarmaProvider.isZadarmaConfigured()) {
    return { ok: false, reason: "not_configured", message: "Zadarma is not configured yet (missing ZADARMA_API_KEY/ZADARMA_API_SECRET)." };
  }
  try {
    const { balance, currency } = await zadarmaProvider.getBalance();
    const required = Number(destination.connect_fee) + Number(destination.monthly_fee);
    const available = Number(balance);
    if (Number.isFinite(required) && Number.isFinite(available) && available < required) {
      return {
        ok: false,
        reason: "insufficient",
        message: `Account balance (${balance} ${currency}) is below the estimated cost of this number (${required} ${destination.currency}). Top up your Zadarma balance before purchasing.`,
      };
    }
    return { ok: true, balance, currency };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not check Zadarma balance.";
    return { ok: false, reason: "error", message };
  }
}

// ---------------------------------------------------------------------------
// Write — document setup (free) and the one paid call (order/)
// ---------------------------------------------------------------------------

export async function createDocumentGroup(fields: Record<string, string>) {
  await assertSuperuser();
  return zadarmaProvider.createDocumentGroup(fields);
}

export async function uploadDocument(groupId: string, fileFieldName: string, file: Blob, filename: string, extraFields?: Record<string, string>) {
  await assertSuperuser();
  return zadarmaProvider.uploadDocument(groupId, fileFieldName, file, filename, extraFields);
}

export type PurchaseResult =
  | { ok: true; number: string }
  | {
      ok: false;
      reason: "not_configured" | "already_purchasing" | "needs_manual_check" | "error";
      message: string;
    };

/** Performs the actual order/ call + activation for an already-claimed
 * PENDING row. Shared by purchaseNumber (a fresh row) and retryPurchase (a
 * row reclaimed from FAILED) so the paid-call/failure-classification logic
 * exists in exactly one place — mirrors whapiOnboarding.ts's
 * provisionClaimedRow precisely. */
async function provisionClaimedRow(
  row: ZadarmaNumber,
  input: { directionId: string; documentsGroupId: string; numberId?: string; monthlyFee: string | null; connectFee: string | null; currency: string | null }
): Promise<PurchaseResult> {
  try {
    const result = await zadarmaProvider.orderNumber({
      directionId: input.directionId,
      documentsGroupId: input.documentsGroupId,
      numberId: input.numberId,
    });

    if (!result.is_activated && !result.is_reserved) {
      // Zadarma accepted the request but didn't confirm activation or even
      // a reservation — treat this as ambiguous rather than assuming
      // success, same "don't guess" principle as every other provider
      // integration in this app.
      await zadarmaNumbersRepo.markFailed(
        row.id,
        "FAILED_NEEDS_MANUAL_CHECK",
        `Zadarma returned neither is_activated nor is_reserved for number ${result.number ?? "(unknown)"} — check the Zadarma dashboard before retrying.`
      );
      return {
        ok: false,
        reason: "needs_manual_check",
        message: "Zadarma's response didn't clearly confirm activation. Check the Zadarma dashboard before retrying — do not purchase again.",
      };
    }

    await zadarmaNumbersRepo.markActive(row.id, {
      number: result.number,
      monthlyFee: input.monthlyFee,
      connectFee: input.connectFee,
      currency: input.currency,
      documentsGroupId: input.documentsGroupId,
    });
    return { ok: true, number: result.number };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error ordering the Zadarma number.";
    if (isAmbiguousFailure(e)) {
      await zadarmaNumbersRepo.markFailed(row.id, "FAILED_NEEDS_MANUAL_CHECK", `Ambiguous failure (possibly purchased on Zadarma's side): ${message}`);
      return {
        ok: false,
        reason: "needs_manual_check",
        message: "Zadarma's response was inconclusive (timeout or network error) — it's unknown whether a number was actually purchased. Check the Zadarma dashboard for an unexpected charge before retrying.",
      };
    }
    await zadarmaNumbersRepo.markFailed(row.id, "FAILED", message);
    return { ok: false, reason: "error", message };
  }
}

/** The one paid entry point. Duplicate-paid-purchase guard: insertPending is
 * attempted FIRST, before any Zadarma call — the partial unique index on
 * zadarma_numbers (companyId WHERE status='PENDING') means a double-click, a
 * browser-retried slow request, or two Superusers buying for the same
 * company at once can only ever have one attempt win that insert. Every
 * other concurrent/duplicate attempt gets a unique-violation here and
 * returns immediately, never reaching the paid order/ call below.
 *
 * `monthlyFee`/`connectFee`/`currency` are exactly what was shown to the
 * Superuser on the confirm screen (requirement: display pricing before
 * purchase) — passed through and stored as-is, never re-fetched, so the
 * stored record reflects what was actually agreed to. */
export async function purchaseNumber(input: {
  companyId: string;
  countryCode: string;
  directionId: string;
  documentsGroupId: string;
  numberId?: string;
  monthlyFee: string | null;
  connectFee: string | null;
  currency: string | null;
}): Promise<PurchaseResult> {
  const session = await assertSuperuser();

  if (!zadarmaProvider.isZadarmaConfigured()) {
    return { ok: false, reason: "not_configured", message: "Zadarma is not configured yet (missing ZADARMA_API_KEY/ZADARMA_API_SECRET)." };
  }

  const company = await companiesRepo.findById(input.companyId);
  if (!company) throw new Error("Company not found.");

  let row: ZadarmaNumber;
  try {
    row = await zadarmaNumbersRepo.insertPending({
      companyId: input.companyId,
      directionId: input.directionId,
      countryCode: input.countryCode,
      purchasedBy: session.user.id,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return {
        ok: false,
        reason: "already_purchasing",
        message: "A number purchase for this company is already in progress — no new order was placed.",
      };
    }
    throw e;
  }

  return provisionClaimedRow(row, input);
}

/** Manual retry for a purchase that previously failed cleanly (status
 * FAILED, never FAILED_NEEDS_MANUAL_CHECK — see confirmNoChargeOccurred).
 * claimForRetry's conditional UPDATE is the same race-closer as
 * purchaseNumber's insertPending above: only one concurrent retry click can
 * ever win it. */
export async function retryPurchase(
  numberRowId: string,
  input: { documentsGroupId: string; numberId?: string; monthlyFee: string | null; connectFee: string | null; currency: string | null }
): Promise<PurchaseResult> {
  await assertSuperuser();
  const row = await zadarmaNumbersRepo.claimForRetry(numberRowId);
  if (!row) {
    return { ok: false, reason: "error", message: "No retryable purchase found — it may already be active, still in progress, or waiting on a manual check." };
  }
  // A FAILED row can only ever come from the real order/ purchase flow
  // (insertPending always sets directionId) — never from "Add Existing
  // Number" (insertExisting), which goes straight to ACTIVE with no order/
  // call to fail in the first place. This null check is defensive, not
  // expected to ever actually trigger.
  if (!row.directionId) {
    return { ok: false, reason: "error", message: "This number's destination is unknown — it can't be retried through the purchase flow." };
  }
  return provisionClaimedRow(row, { directionId: row.directionId, ...input });
}

/** The explicit, human action that unblocks retrying after an ambiguous
 * failure — a Superuser confirms (by checking Zadarma's own dashboard) that
 * no number was actually purchased for this attempt. Never called
 * automatically. */
export async function confirmNoChargeOccurred(numberRowId: string): Promise<{ ok: boolean; message: string }> {
  await assertSuperuser();
  const row = await zadarmaNumbersRepo.acknowledgeManualCheck(numberRowId);
  if (!row) {
    return { ok: false, message: "No purchase awaiting manual confirmation was found." };
  }
  return { ok: true, message: "Acknowledged — this purchase can now be retried." };
}

// ---------------------------------------------------------------------------
// Management — existing numbers, reassignment (requirement #8)
// ---------------------------------------------------------------------------

export async function listNumbers() {
  await assertSuperuser();
  return zadarmaNumbersRepo.findAll();
}

export type CompanyZadarmaStatus = {
  companyId: string;
  status: "NONE" | "PENDING" | "ACTIVE" | "FAILED" | "FAILED_NEEDS_MANUAL_CHECK";
  number: string | null;
  numberRowId: string | null;
};

/** DB-only (no Zadarma call) status per company — same role as
 * metricoolOnboarding/whapiOnboarding's own getProvisioningStatusForCompanies,
 * safe on every Configuración page load. Prefers an ACTIVE row; falls back
 * to the most recently created PENDING/FAILED attempt so an in-progress or
 * failed purchase still shows on the card instead of silently looking like
 * "never tried". */
export async function getProvisioningStatusForCompanies(companyIds: string[]): Promise<CompanyZadarmaStatus[]> {
  await assertSuperuser();
  const rows = await zadarmaNumbersRepo.findByCompanyIds(companyIds);
  return companyIds.map((companyId) => {
    const companyRows = rows.filter((r) => r.companyId === companyId);
    const active = companyRows.find((r) => r.status === "ACTIVE");
    const row = active ?? [...companyRows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return {
      companyId,
      status: (row?.status as CompanyZadarmaStatus["status"]) ?? "NONE",
      number: row?.number ?? null,
      numberRowId: row?.id ?? null,
    };
  });
}

/** Pure CRM-side routing change — no Zadarma API call. Pass companyId: null
 * to unassign a number entirely (it stays ACTIVE and purchased, just not
 * routed to any company until reassigned again). */
export async function reassignNumber(numberRowId: string, companyId: string | null) {
  await assertSuperuser();
  if (companyId) {
    const company = await companiesRepo.findById(companyId);
    if (!company) throw new Error("Company not found.");
  }
  const row = await zadarmaNumbersRepo.reassignCompany(numberRowId, companyId);
  if (!row) throw new Error("Number not found, or it isn't an active purchased number.");
  return row;
}

// ---------------------------------------------------------------------------
// "Add Existing Number" — Feature 2. Never calls order/ or any other write
// endpoint — listOwnedNumbers() (used to verify) is read-only, and the rest
// is this CRM's own database. directionId/countryCode stay null for a
// number added this way (see db/schema.ts's comment) rather than
// fabricating values Zadarma's real response never provides.
// ---------------------------------------------------------------------------

export type LinkExistingNumberResult = { ok: true; number: string } | { ok: false; reason: ZadarmaErrorReason | "already_linked" | "not_found_on_account"; message: string };

export async function linkExistingNumber(input: { number: string; companyId: string }): Promise<LinkExistingNumberResult> {
  const session = await assertSuperuser();

  if (!zadarmaProvider.isZadarmaConfigured()) {
    return { ok: false, reason: "not_configured", message: "Zadarma is not configured yet (missing ZADARMA_API_KEY/ZADARMA_API_SECRET)." };
  }

  const company = await companiesRepo.findById(input.companyId);
  if (!company) throw new Error("Company not found.");

  // Friendly pre-check — the real guarantee is the global unique index on
  // `number`, this just gives a clearer reason than a raw unique-violation.
  const existing = await zadarmaNumbersRepo.findByNumber(input.number);
  if (existing) {
    return { ok: false, reason: "already_linked", message: `${input.number} is already linked in this CRM (status: ${existing.status}).` };
  }

  // Verify ownership against the real, connected Zadarma account before
  // ever saving anything — never trust a typed-in number.
  let owned: zadarmaProvider.ZadarmaOwnedNumber[];
  try {
    owned = await zadarmaProvider.listOwnedNumbers();
  } catch (e) {
    const { reason, message } = classifyError(e);
    return { ok: false, reason, message };
  }
  const match = owned.find((n) => n.number === input.number);
  if (!match) {
    return {
      ok: false,
      reason: "not_found_on_account",
      message: `${input.number} was not found among this Zadarma account's owned numbers. Check it's typed exactly as Zadarma shows it.`,
    };
  }

  try {
    const row = await zadarmaNumbersRepo.insertExisting({
      number: input.number,
      companyId: input.companyId,
      monthlyFee: match.monthly_fee ?? null,
      currency: match.currency ?? null,
      purchasedBy: session.user.id,
    });
    return { ok: true, number: row.number as string };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { ok: false, reason: "already_linked", message: "This number was linked by another request just now — no duplicate was created." };
    }
    throw e;
  }
}
