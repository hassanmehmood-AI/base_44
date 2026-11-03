import { and, eq, ne, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { companyEmailAccounts } from "@/db/schema";

export type CompanyEmailAccount = typeof companyEmailAccounts.$inferSelect;

export async function findByCompanyId(companyId: string): Promise<CompanyEmailAccount[]> {
  return getDb().select().from(companyEmailAccounts).where(eq(companyEmailAccounts.companyId, companyId));
}

export async function findByCompanyIds(companyIds: string[]): Promise<CompanyEmailAccount[]> {
  if (companyIds.length === 0) return [];
  return getDb().select().from(companyEmailAccounts).where(inArray(companyEmailAccounts.companyId, companyIds));
}

export async function findById(id: string): Promise<CompanyEmailAccount | undefined> {
  const [row] = await getDb().select().from(companyEmailAccounts).where(eq(companyEmailAccounts.id, id)).limit(1);
  return row;
}

/** The actual uniqueness guarantee lives in the database (see db/schema.ts's
 * company_email_accounts_active_address_idx — a partial, case-insensitive,
 * global unique index), so this is a convenience pre-check for a clearer
 * error message before attempting the insert, never the real enforcement
 * mechanism. excludeAccountId lets a reconnect-in-place flow check "is this
 * address used by any OTHER row" without false-positiving on itself. */
export async function findActiveByEmailAddress(
  emailAddress: string,
  excludeAccountId?: string
): Promise<CompanyEmailAccount | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(companyEmailAccounts)
    .where(
      and(
        eq(companyEmailAccounts.emailAddress, emailAddress.trim().toLowerCase()),
        ne(companyEmailAccounts.status, "DISCONNECTED"),
        excludeAccountId ? ne(companyEmailAccounts.id, excludeAccountId) : undefined
      )
    )
    .limit(1);
  return rows[0];
}

/** Resolves which company's mailbox a Pub/Sub push notification is for —
 * the payload only carries the mailbox's own address (see
 * api/webhooks/gmail/route.ts), never our internal id. Excludes
 * DISCONNECTED the same way findActiveByEmailAddress does, since a
 * notification for an address we no longer actively manage should be
 * acknowledged and dropped, not acted on. */
export async function findByEmailAddress(emailAddress: string): Promise<CompanyEmailAccount | undefined> {
  const [row] = await getDb()
    .select()
    .from(companyEmailAccounts)
    .where(
      and(
        eq(companyEmailAccounts.emailAddress, emailAddress.trim().toLowerCase()),
        ne(companyEmailAccounts.status, "DISCONNECTED")
      )
    )
    .limit(1);
  return row;
}

/** System-wide, not company-scoped — used only by the gmail-sync cron
 * sweep (api/cron/gmail-sync/route.ts), which runs independently of any
 * logged-in user/session and must check every company's mailboxes, not
 * one. Same "query the table directly, no session involved" precedent as
 * avatarCapture.ts's findPendingAvatarCaptures. */
export async function findAllActive(): Promise<CompanyEmailAccount[]> {
  return getDb().select().from(companyEmailAccounts).where(eq(companyEmailAccounts.status, "ACTIVE"));
}

/** Inserts the connected mailbox as ACTIVE directly — unlike whapiChannels'
 * insertPending-then-provision two-step (needed there because createChannel
 * is itself a paid, non-idempotent API call to guard against), by the time
 * this is called the OAuth code exchange has already fully succeeded; there
 * is no "ambiguous failure, might have been created" state to protect
 * against here, so one insert is sufficient. */
export async function create(data: {
  companyId: string;
  provider: string;
  emailAddress: string;
  displayName: string | null;
  encryptedRefreshToken: string;
  encryptedAccessToken: string;
  accessTokenExpiresAt: Date;
  grantedScopes: string;
}): Promise<CompanyEmailAccount> {
  const [row] = await getDb()
    .insert(companyEmailAccounts)
    .values({ ...data, emailAddress: data.emailAddress.trim().toLowerCase(), status: "ACTIVE" })
    .returning();
  return row;
}

export async function updateTokens(
  id: string,
  data: { encryptedRefreshToken?: string; encryptedAccessToken: string; accessTokenExpiresAt: Date; grantedScopes?: string }
): Promise<void> {
  await getDb()
    .update(companyEmailAccounts)
    .set({ ...data, status: "ACTIVE", lastError: null, updatedAt: new Date() })
    .where(eq(companyEmailAccounts.id, id));
}

/** Set when a refresh attempt itself fails with an auth error (token
 * revoked by the user, or by a Workspace admin) — distinct from a transient
 * network/API error, which should just be retried on the next send/sync
 * attempt rather than forcing the company through reconnection again. */
export async function markNeedsReauth(id: string, lastError: string): Promise<void> {
  await getDb()
    .update(companyEmailAccounts)
    .set({ status: "NEEDS_REAUTH", lastError, updatedAt: new Date() })
    .where(eq(companyEmailAccounts.id, id));
}

/** Advances the inbound-sync cursor after a successful watch registration
 * or history sync (see integrations/google.ts's watchMailbox/listHistory
 * and services/gmailSync.ts). watchExpiration is only passed when a watch
 * was just (re-)registered — a plain history sync only moves historyId
 * forward, it doesn't touch the watch's own expiry. */
export async function updateSyncState(id: string, data: { historyId: string; watchExpiration?: Date }): Promise<void> {
  await getDb()
    .update(companyEmailAccounts)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(companyEmailAccounts.id, id));
}

/** Never deletes the row (see db/schema.ts's status comment — conversations.
 * companyEmailAccountId must keep resolving for historical messages).
 * Clears both encrypted token columns on disconnect: once a mailbox is
 * disconnected there is no remaining legitimate use for its tokens, so
 * there's no reason to keep them at rest — this shrinks the blast radius of
 * a future key compromise to only currently-active connections. */
export async function markDisconnected(id: string): Promise<void> {
  await getDb()
    .update(companyEmailAccounts)
    .set({
      status: "DISCONNECTED",
      encryptedRefreshToken: null,
      encryptedAccessToken: null,
      accessTokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(companyEmailAccounts.id, id));
}
