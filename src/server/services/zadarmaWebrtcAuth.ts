import * as zadarmaExtensionsRepo from "@/server/repositories/zadarmaExtensions";
import * as zadarmaNumbersRepo from "@/server/repositories/zadarmaNumbers";
import * as zadarmaProvider from "@/server/integrations/zadarma";
import { requireSession, UnauthorizedError } from "@/server/services/authorization";
import { ProviderNotConfiguredError } from "@/server/integrations/errors";

/** Mints the short-lived browser-calling credential for the SIGNED-IN
 * user's OWN extension only — this is the one place the real account API
 * key/secret ever gets anywhere near a browser-calling flow, and even here
 * it never leaves the server: only the resulting {sip, key} pair is
 * returned to the client, which is exactly what Zadarma's own widget
 * embed (`zadarmaWidgetFn`) needs and nothing more. */

/** Zadarma's own CRM-widget integration docs describe the widget's `sip`
 * argument as "your SIP-number or full PBX extension number login" — the
 * FULL login, not the bare extension digits this app stores in
 * zadarma_extensions.sipExtension (e.g. "100"). The full login combines
 * the account's PBX id with the extension as `<pbxId>-<extension>` (e.g.
 * "588158-100") — confirmed against a real account's own terminology
 * during manual testing (2026-11-14), which is what finally explained why
 * browser calls started a local timer but never actually rang: the
 * credential/widget were being initialized under the bare extension
 * number, not this full login.
 *
 * Built live via listPbxExtensions() (free, read-only, already used
 * elsewhere — see checkExtensionLimits) rather than stored on the row,
 * since the PBX id is a single account-wide constant, not a per-extension
 * value worth duplicating in the database.
 *
 * Defensive: if the stored value already contains a "-" (e.g. a
 * Superuser manually typed the full login via "Add Existing SIP" instead
 * of the bare extension), it's used as-is — never double-prefixed.
 * Exported only so tests can exercise the short-circuit path directly. */
export async function resolveFullSipLogin(sipExtension: string): Promise<string> {
  if (sipExtension.includes("-")) return sipExtension;
  const { pbxId } = await zadarmaProvider.listPbxExtensions();
  // Never fabricate a login if the real PBX id couldn't be resolved —
  // fall back to what's stored rather than guessing a prefix.
  if (!pbxId) return sipExtension;
  return `${pbxId}-${sipExtension}`;
}

export type WebrtcCredentialsReason =
  | "not_configured"
  | "provisioning_disabled"
  | "no_extension"
  | "caller_id_mismatch"
  | "auth"
  | "rate_limit"
  | "network"
  | "error";

export type WebrtcCredentialsResult =
  | { ok: true; sip: string; key: string }
  | { ok: false; reason: WebrtcCredentialsReason; message: string };

export async function getMyWebrtcCredentials(): Promise<WebrtcCredentialsResult> {
  const session = await requireSession();

  if (!zadarmaProvider.isZadarmaConfigured()) {
    return { ok: false, reason: "not_configured", message: "Zadarma is not configured yet (missing ZADARMA_API_KEY/ZADARMA_API_SECRET)." };
  }

  // Deliberately NOT a Superuser-only check — any signed-in agent may fetch
  // credentials for THEIR OWN extension, the same way any agent can place a
  // click-to-call today. What stays Superuser-only is CREATING/reassigning/
  // revoking extensions (zadarmaExtensionOnboarding.ts) — using one you
  // already own is not an admin action.
  const extension = await zadarmaExtensionsRepo.findActiveByUserId(session.user.id);
  if (!extension?.sipExtension) {
    return { ok: false, reason: "no_extension", message: "You don't have an active SIP extension yet — ask a Superuser to create one for you in Configuración." };
  }

  // The Caller ID integrity gate: "Add Existing SIP" can link an extension
  // whose real Caller ID doesn't match its company's number (by design —
  // never silently changed). Before this extension is ever allowed to
  // place a real browser call, confirm its stored Caller ID still equals
  // the company's own CURRENT active number — never fix the mismatch here,
  // only refuse. A company with no active number at all is treated the
  // same way (nothing to match against).
  const activeNumber = extension.companyId ? await zadarmaNumbersRepo.findActiveByCompanyId(extension.companyId) : undefined;
  if (!activeNumber?.number || extension.callerIdNumber !== activeNumber.number) {
    return {
      ok: false,
      reason: "caller_id_mismatch",
      message: "Browser calling is disabled for your extension — its Caller ID doesn't match your company's current Zadarma number. Ask a Superuser to resolve this before calling.",
    };
  }

  try {
    const fullSipLogin = await resolveFullSipLogin(extension.sipExtension);
    const { key, sip } = await zadarmaProvider.getWebrtcKey(fullSipLogin);
    return { ok: true, sip, key };
  } catch (e) {
    return { ok: false, ...classifyError(e) };
  }
}

/** Exported only so tests can exercise this classification directly,
 * same idiom as zadarmaExtensionOnboarding.ts's classifyError. */
export function classifyError(e: unknown): { reason: WebrtcCredentialsReason; message: string } {
  if (e instanceof ProviderNotConfiguredError) return { reason: "not_configured", message: e.message };
  if (e instanceof UnauthorizedError) return { reason: "auth", message: e.message };
  if (e instanceof zadarmaProvider.ZadarmaProvisioningDisabledError) return { reason: "provisioning_disabled", message: e.message };
  if (e instanceof zadarmaProvider.ZadarmaAuthError) return { reason: "auth", message: e.message };
  if (e instanceof zadarmaProvider.ZadarmaRateLimitError) return { reason: "rate_limit", message: e.message };
  if (e instanceof zadarmaProvider.ZadarmaNetworkError) return { reason: "network", message: e.message };
  if (e instanceof Error) return { reason: "error", message: e.message };
  return { reason: "error", message: "Unknown error." };
}
