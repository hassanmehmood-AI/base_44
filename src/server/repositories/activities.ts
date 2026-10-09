import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, users } from "@/db/schema";

export type Activity = typeof activities.$inferSelect;
export type ActivityWithAuthor = Activity & { authorName: string };

export async function findRecentByContactId(contactId: string, limit = 20): Promise<ActivityWithAuthor[]> {
  const rows = await getDb()
    .select({ activity: activities, authorName: users.fullName })
    .from(activities)
    .innerJoin(users, eq(activities.createdBy, users.id))
    .where(eq(activities.contactId, contactId))
    .orderBy(desc(activities.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.activity, authorName: r.authorName }));
}

/** Append-only insert. There is intentionally no update/delete here — the
 * DB trigger (see migrations/0001_append_only_triggers.sql) rejects both anyway.
 * Takes `db` explicitly (rather than calling getDb() itself) so callers can pass
 * a transaction and have the activity insert commit/rollback with the rest of
 * the contact update it accompanies. */
export type NewActivity = typeof activities.$inferInsert;
export async function create(db: ReturnType<typeof getDb>, data: NewActivity) {
  const [row] = await db.insert(activities).values(data).returning();
  return row;
}

export async function createMany(db: ReturnType<typeof getDb>, rows: NewActivity[]) {
  if (rows.length === 0) return [];
  return db.insert(activities).values(rows).returning();
}

/** KPIs §15 "Contacted" definition: distinct contacts with at least one logged
 * CALL/EMAIL/SOCIAL activity, scoped to the given companies. When `since` is
 * given (period filter), only counts activities logged within the period —
 * "contacted this month" means outreach happened this month, regardless of
 * when the contact itself was created. */
export async function findContactedContactIds(companyIds: string[], since?: Date): Promise<string[]> {
  if (companyIds.length === 0) return [];
  const rows = await getDb()
    .selectDistinct({ contactId: activities.contactId })
    .from(activities)
    .where(
      and(
        inArray(activities.companyId, companyIds),
        inArray(activities.type, ["CALL", "EMAIL", "SOCIAL"]),
        since ? gte(activities.createdAt, since) : undefined
      )
    );
  return rows.map((r) => r.contactId);
}

/** Campaigns §17 Option B "channel" filter: which real activity channels
 * (CALL/EMAIL/SOCIAL/WHATSAPP/NOTE) have actually been logged for each of
 * the given contacts — backed by real data, not an invented per-row field. */
export async function findDistinctChannelsByContactIds(contactIds: string[]): Promise<{ contactId: string; channel: string }[]> {
  if (contactIds.length === 0) return [];
  return getDb()
    .selectDistinct({ contactId: activities.contactId, channel: activities.channel })
    .from(activities)
    .where(and(inArray(activities.contactId, contactIds), isNotNull(activities.channel))) as Promise<{ contactId: string; channel: string }[]>;
}

export type StageChangeRow = { companyId: string; contactId: string; createdAt: Date };

/** KPIs §15 monthly trend: STATUS_CHANGE activities recording a move into the
 * given stage, used as the "became a customer on this date" signal since
 * contacts only store their current stage, not stage history. Includes
 * contactId so callers can attribute each conversion back to the contact's
 * assigned agent (e.g. for department filtering). */
export async function findStatusChangesToStage(
  companyIds: string[],
  stageKey: string,
  since: Date
): Promise<StageChangeRow[]> {
  if (companyIds.length === 0) return [];
  return getDb()
    .select({ companyId: activities.companyId, contactId: activities.contactId, createdAt: activities.createdAt })
    .from(activities)
    .where(
      and(
        inArray(activities.companyId, companyIds),
        eq(activities.type, "STATUS_CHANGE"),
        eq(activities.outcome, stageKey),
        gte(activities.createdAt, since)
      )
    );
}

export type StatusChangeContactRow = { companyId: string; contactId: string };

/** KPIs §15 period filter: distinct (company, contact) pairs that transitioned
 * into any of the given stages (e.g. OPPORTUNITY_STAGE_KEYS/CUSTOMER_STAGE_KEYS
 * from @/lib/pipeline) within the period — the "generated this month" flow
 * metric, as opposed to the all-time view's "currently at this stage" snapshot.
 * A contact created before the period still counts if it crossed into the
 * stage during the period. */
export async function findStatusChangeContactIds(
  companyIds: string[],
  stageKeys: string[],
  since: Date
): Promise<StatusChangeContactRow[]> {
  if (companyIds.length === 0 || stageKeys.length === 0) return [];
  return getDb()
    .selectDistinct({ companyId: activities.companyId, contactId: activities.contactId })
    .from(activities)
    .where(
      and(
        inArray(activities.companyId, companyIds),
        eq(activities.type, "STATUS_CHANGE"),
        inArray(activities.outcome, stageKeys),
        gte(activities.createdAt, since)
      )
    );
}
