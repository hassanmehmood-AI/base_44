import { desc, eq } from "drizzle-orm";
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
