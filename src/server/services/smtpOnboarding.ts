import * as companyEmailAccountsRepo from "@/server/repositories/companyEmailAccounts";
import type { CompanyEmailAccount } from "@/server/repositories/companyEmailAccounts";
import * as smtpProvider from "@/server/integrations/smtp";
import type { SmtpSecurity } from "@/server/integrations/smtp";
import * as imapProvider from "@/server/integrations/imap";
import { encryptSecret, decryptSecret, isEncryptionKeyConfigured } from "@/server/crypto/smtpSecretBox";
import { assertCompanyAccess, requireSession, UnauthorizedError } from "@/server/services/authorization";

/** Universal SMTP/IMAP mailbox onboarding — the generic-webmail equivalent
 * of emailOnboarding.ts (which stays Google-specific and untouched). No
 * OAuth redirect dance here: a company enters its own server details
 * directly, this module tests the connection for real, then saves the
 * credentials. Superuser-only, same restriction and same reasoning as
 * Google's onboarding — connecting a mailbox grants the CRM ongoing send/
 * read access to a real inbox, not a day-to-day CRM operation. */
async function assertSuperuser() {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") {
    throw new UnauthorizedError("Only Superusers can connect or disconnect email accounts.");
  }
  return session;
}

export type SmtpImapInput = {
  emailAddress: string;
  displayName?: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  imapHost: string;
  imapPort: number;
  imapSecurity: SmtpSecurity;
  username: string;
  password: string;
};

export type TestConnectionResult =
  | { ok: true }
  | { ok: false; smtpError: string | null; imapError: string | null };

/** Tests both servers in parallel — the "Test connection" button's action.
 * Deliberately separate from connectAccount below (a company can test
 * repeatedly before committing) but connectAccount ALSO re-runs this same
 * check server-side before saving (never trusts a client's "I already
 * tested this" claim), so a stale/tampered form submission can never save
 * credentials that don't actually work. */
export async function testConnection(input: SmtpImapInput): Promise<TestConnectionResult> {
  const [smtpResult, imapResult] = await Promise.all([
    smtpProvider.testSmtpConnection({
      host: input.smtpHost,
      port: input.smtpPort,
      security: input.smtpSecurity,
      username: input.username,
      password: input.password,
    }),
    imapProvider.testImapConnection({
      host: input.imapHost,
      port: input.imapPort,
      security: input.imapSecurity,
      username: input.username,
      password: input.password,
    }),
  ]);

  if (smtpResult.ok && imapResult.ok) return { ok: true };
  return {
    ok: false,
    smtpError: smtpResult.ok ? null : smtpResult.message,
    imapError: imapResult.ok ? null : imapResult.message,
  };
}

export type ConnectResult =
  | { ok: true; account: CompanyEmailAccount }
  | { ok: false; reason: "connection_failed" | "already_connected" | "not_configured"; message: string };

/** Saves a new SMTP/IMAP mailbox connection after re-verifying both servers
 * for real (see testConnection's doc comment on why this isn't trusted
 * from the client alone). Establishes the IMAP sync baseline (uidValidity +
 * current uidNext) in the same call, same "connect and start syncing from
 * here, never backfill history" guarantee as Google's registerWatch /
 * establishHistoryBaseline. */
export async function connectAccount(companyId: string, input: SmtpImapInput): Promise<ConnectResult> {
  await assertSuperuser();
  await assertCompanyAccess(companyId);

  if (!isEncryptionKeyConfigured()) {
    return { ok: false, reason: "not_configured", message: "SMTP_CREDENTIAL_ENCRYPTION_KEY is not configured — cannot safely store this mailbox's password." };
  }

  const verify = await testConnection(input);
  if (!verify.ok) {
    const parts = [verify.smtpError && `SMTP: ${verify.smtpError}`, verify.imapError && `IMAP: ${verify.imapError}`].filter(Boolean);
    return { ok: false, reason: "connection_failed", message: parts.join(" — ") || "Could not connect with the provided details." };
  }

  const existing = await companyEmailAccountsRepo.findActiveByEmailAddress(input.emailAddress);
  if (existing) {
    return {
      ok: false,
      reason: "already_connected",
      message: `${input.emailAddress} is already connected to another company in Growth On. Disconnect it there first before connecting it here.`,
    };
  }

  let baseline: { uidValidity: string; lastUid: string };
  try {
    baseline = await imapProvider.getMailboxUidValidity({
      host: input.imapHost,
      port: input.imapPort,
      security: input.imapSecurity,
      username: input.username,
      password: input.password,
    });
  } catch (e) {
    return { ok: false, reason: "connection_failed", message: e instanceof Error ? e.message : "Could not establish the inbox sync starting point." };
  }

  const account = await companyEmailAccountsRepo.createSmtp({
    companyId,
    emailAddress: input.emailAddress,
    displayName: input.displayName ?? null,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    smtpSecurity: input.smtpSecurity,
    imapHost: input.imapHost,
    imapPort: input.imapPort,
    imapSecurity: input.imapSecurity,
    smtpImapUsername: input.username,
    encryptedPassword: encryptSecret(input.password),
  });
  await companyEmailAccountsRepo.updateImapSyncState(account.id, { imapUidValidity: baseline.uidValidity, imapLastSeenUid: baseline.lastUid });

  return { ok: true, account };
}

export async function listAccountsForCompany(companyId: string): Promise<CompanyEmailAccount[]> {
  await assertCompanyAccess(companyId);
  return companyEmailAccountsRepo.findByCompanyId(companyId);
}

/** Deliberately self-contained — does not call anything in
 * emailOnboarding.ts (no shared code path with the Google integration),
 * so this can never affect or depend on Gmail's own disconnect behavior. */
export async function disconnectAccount(id: string): Promise<void> {
  const account = await companyEmailAccountsRepo.findById(id);
  if (!account) throw new Error("Email account not found.");
  await assertSuperuser();
  await assertCompanyAccess(account.companyId);
  await companyEmailAccountsRepo.markDisconnected(id);
}

/** Decrypts this account's stored password — the one function send/sync
 * code should ever call to get a usable credential, same "no caller reads
 * the encrypted column directly" convention as emailOnboarding.ts's
 * getValidAccessToken. Unlike Google's OAuth tokens, there's no refresh
 * concept here — SMTP/IMAP passwords don't expire on their own; a failed
 * login is handled by the caller marking the account NEEDS_REAUTH (see
 * smtpSync usage), not by this function. */
export function getPassword(account: CompanyEmailAccount): string {
  if (!account.encryptedPassword) throw new Error("This mailbox has no stored password — it must be reconnected.");
  return decryptSecret(account.encryptedPassword);
}
