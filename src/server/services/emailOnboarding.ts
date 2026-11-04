import * as companyEmailAccountsRepo from "@/server/repositories/companyEmailAccounts";
import type { CompanyEmailAccount } from "@/server/repositories/companyEmailAccounts";
import * as companiesRepo from "@/server/repositories/companies";
import * as googleProvider from "@/server/integrations/google";
import { GoogleApiError } from "@/server/integrations/google";
import { signGoogleOAuthState, verifyGoogleOAuthState } from "@/server/services/googleOAuthState";
import { encryptSecret, decryptSecret, isEncryptionKeyConfigured } from "@/server/crypto/googleSecretBox";
import { assertCompanyAccess, requireSession, UnauthorizedError } from "@/server/services/authorization";

/** Google Workspace / Gmail mailbox onboarding — the Google equivalent of
 * whapiOnboarding.ts. Superuser-only for the same reason Whapi channel
 * provisioning is: connecting a mailbox is a sensitive, company-wide admin
 * action (grants the CRM ongoing send/read access to a real inbox), not a
 * day-to-day CRM operation any role should trigger. */
async function assertSuperuser() {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") {
    throw new UnauthorizedError("Only Superusers can connect or disconnect email accounts.");
  }
  return session;
}

export type StartAuthorizationResult = { ok: true; url: string } | { ok: false; message: string };

/** Starts the OAuth flow — returns the URL the browser should be redirected
 * to. Deliberately returns a plain result object rather than throwing for
 * the "not configured" case, same convention as whapiOnboarding's
 * ProvisionResult, so a Configuración action can show a clear message
 * instead of a generic error boundary. */
export async function startAuthorization(companyId: string): Promise<StartAuthorizationResult> {
  const session = await assertSuperuser();
  await assertCompanyAccess(companyId);

  if (!googleProvider.isGoogleOAuthConfigured()) {
    return { ok: false, message: "Google OAuth is not configured yet (missing GOOGLE_CLIENT_ID/CLIENT_SECRET/AUTH_URL/TOKEN_URL/REDIRECT_URI)." };
  }
  if (!isEncryptionKeyConfigured()) {
    return { ok: false, message: "GOOGLE_TOKEN_ENCRYPTION_KEY is not configured — cannot safely store this mailbox's tokens." };
  }

  const company = await companiesRepo.findById(companyId);
  if (!company) return { ok: false, message: "Company not found." };

  const state = signGoogleOAuthState({ companyId, issuerId: session.user.id });
  return { ok: true, url: googleProvider.buildAuthorizationUrl(state) };
}

export type CallbackResult =
  | { ok: true; emailAddress: string }
  | { ok: false; reason: "invalid_state" | "already_connected" | "no_refresh_token" | "error"; message: string };

/** Handles Google's redirect back to our callback route: verifies `state`
 * (proves this exact browser started a real, recent, Superuser-initiated
 * flow for this exact company — see googleOAuthState.ts), exchanges the
 * code, resolves which address was actually connected, and persists it.
 *
 * The "one company per Gmail address" rule (see db/schema.ts's partial
 * unique index) is enforced at the database level, but a raw unique-
 * violation would surface as an opaque Postgres error — this catches that
 * specific case and turns it into the clear "already_connected" reason so
 * the UI can explain what actually happened instead of showing "Internal
 * Server Error" for what is, from the user's perspective, an entirely
 * expected outcome (they tried to connect a mailbox someone else already
 * connected). */
export async function handleOAuthCallback(code: string, state: string): Promise<CallbackResult> {
  const payload = verifyGoogleOAuthState(state);
  if (!payload) return { ok: false, reason: "invalid_state", message: "This authorization link is invalid or has expired. Please try connecting again." };

  if (!googleProvider.isGoogleOAuthConfigured() || !isEncryptionKeyConfigured()) {
    return { ok: false, reason: "error", message: "Google OAuth is not fully configured on the server." };
  }

  let tokens: googleProvider.GoogleTokenResponse;
  try {
    tokens = await googleProvider.exchangeCodeForTokens(code);
  } catch (e) {
    const message = e instanceof GoogleApiError || e instanceof Error ? e.message : "Unknown error exchanging the authorization code.";
    return { ok: false, reason: "error", message };
  }

  if (!tokens.refreshToken) {
    // Should not happen given buildAuthorizationUrl always forces
    // prompt=consent, but defending against it explicitly is cheap and the
    // alternative (silently storing a row with no refresh token) would be a
    // mailbox that quietly stops working the moment its first access token
    // expires, ~1 hour after connecting.
    return {
      ok: false,
      reason: "no_refresh_token",
      message: "Google did not return a refresh token. Please try connecting again.",
    };
  }

  let emailAddress: string;
  try {
    emailAddress = await googleProvider.getConnectedEmailAddress(tokens.accessToken);
  } catch (e) {
    const message = e instanceof GoogleApiError || e instanceof Error ? e.message : "Unknown error reading the connected account's address.";
    return { ok: false, reason: "error", message };
  }

  const expiresAt = new Date(Date.now() + tokens.expiresInSeconds * 1000);

  let account: CompanyEmailAccount;
  try {
    account = await companyEmailAccountsRepo.create({
      companyId: payload.companyId,
      provider: "GOOGLE_WORKSPACE",
      emailAddress,
      displayName: null,
      encryptedRefreshToken: encryptSecret(tokens.refreshToken),
      encryptedAccessToken: encryptSecret(tokens.accessToken),
      accessTokenExpiresAt: expiresAt,
      grantedScopes: tokens.grantedScopes,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return {
        ok: false,
        reason: "already_connected",
        message: `${emailAddress} is already connected to another company in Growth On. Disconnect it there first before connecting it here.`,
      };
    }
    throw e;
  }

  await registerWatch(account);
  return { ok: true, emailAddress };
}

/** Registers Gmail push notifications for a freshly-connected mailbox —
 * best-effort by design: a failure here (most commonly GOOGLE_PUBSUB_TOPIC
 * not configured yet, or its Cloud Console publish-rights grant not made
 * yet — see integrations/google.ts's watchMailbox doc comment) must never
 * fail the connect itself. The mailbox is already fully usable for SENDING
 * at this point regardless; only inbound sync is affected, and it can be
 * registered later (e.g. by disconnecting and reconnecting) once Pub/Sub
 * is set up. */
async function registerWatch(account: CompanyEmailAccount): Promise<void> {
  try {
    const accessToken = await getValidAccessToken(account);
    const watch = await googleProvider.watchMailbox(accessToken);
    await companyEmailAccountsRepo.updateSyncState(account.id, { historyId: watch.historyId, watchExpiration: watch.expiration });
  } catch (e) {
    console.error(`[gmail] failed to register watch for account ${account.id}:`, e instanceof Error ? e.message : e);
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505";
}

export async function listAccountsForCompany(companyId: string): Promise<CompanyEmailAccount[]> {
  await assertCompanyAccess(companyId);
  return companyEmailAccountsRepo.findByCompanyId(companyId);
}

export async function disconnectAccount(id: string): Promise<void> {
  const account = await companyEmailAccountsRepo.findById(id);
  if (!account) throw new Error("Email account not found.");
  await assertSuperuser();
  await assertCompanyAccess(account.companyId);

  // Best-effort: stopping the watch is a courtesy to Pub/Sub (Google stops
  // notifying anyway once the revoked/cleared token can no longer be
  // refreshed) — a failure here must never block the disconnect itself.
  if (account.encryptedAccessToken || account.encryptedRefreshToken) {
    try {
      const accessToken = await getValidAccessToken(account);
      await googleProvider.stopWatch(accessToken);
    } catch (e) {
      console.error(`[gmail] failed to stop watch for account ${id}:`, e instanceof Error ? e.message : e);
    }
  }

  await companyEmailAccountsRepo.markDisconnected(id);
}

/** Returns a currently-valid access token for this account, refreshing it
 * first if the cached one has expired (a 60s safety margin avoids a token
 * expiring mid-request). This is the one function send/sync code should
 * ever call to get a usable token — callers never read
 * encryptedAccessToken/encryptedRefreshToken directly. On a refresh
 * failure caused by the token itself being invalid (revoked by the user or
 * a Workspace admin — distinct from a transient network error, which
 * propagates as-is for the caller to retry later), marks the account
 * NEEDS_REAUTH so Configuración can surface "reconnect this mailbox"
 * rather than silently failing every subsequent send. */
export async function getValidAccessToken(account: CompanyEmailAccount): Promise<string> {
  const REFRESH_MARGIN_MS = 60_000;
  if (account.encryptedAccessToken && account.accessTokenExpiresAt && account.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now()) {
    return decryptSecret(account.encryptedAccessToken);
  }
  if (!account.encryptedRefreshToken) {
    await companyEmailAccountsRepo.markNeedsReauth(account.id, "No refresh token on file — this mailbox must be reconnected.");
    throw new Error("This mailbox needs to be reconnected.");
  }

  try {
    const refreshToken = decryptSecret(account.encryptedRefreshToken);
    const refreshed = await googleProvider.refreshAccessToken(refreshToken);
    const expiresAt = new Date(Date.now() + refreshed.expiresInSeconds * 1000);
    await companyEmailAccountsRepo.updateTokens(account.id, {
      encryptedAccessToken: encryptSecret(refreshed.accessToken),
      accessTokenExpiresAt: expiresAt,
    });
    return refreshed.accessToken;
  } catch (e) {
    if (e instanceof GoogleApiError && (e.status === 400 || e.status === 401)) {
      await companyEmailAccountsRepo.markNeedsReauth(account.id, e.message);
      throw new Error("This mailbox's access was revoked and needs to be reconnected.");
    }
    throw e;
  }
}

/** Sends through this specific connected mailbox — called by
 * services/email.ts's sendEmailToContact whenever a conversation's
 * companyEmailAccountId points at an ACTIVE account; otherwise that
 * function still uses the single global Resend sender. bodyHtml, when
 * provided, must already be sanitized (see lib/emailHtml.ts) — this
 * function has no opinion on sanitization, only on sending. attachments
 * bytes must already be validated/size-checked by the caller (see
 * lib/emailAttachments.ts) — same division of responsibility. */
export async function sendFromAccount(
  accountId: string,
  input: {
    to: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string | null;
    attachments?: { filename: string; mimeType: string; bytes: Uint8Array }[];
  }
): Promise<{ externalId: string | null }> {
  const account = await companyEmailAccountsRepo.findById(accountId);
  if (!account) throw new Error("Email account not found.");
  await assertCompanyAccess(account.companyId);
  if (account.status !== "ACTIVE") throw new Error("This mailbox is not active — reconnect it before sending.");

  const accessToken = await getValidAccessToken(account);
  return googleProvider.sendGmailMessage(accessToken, input);
}
