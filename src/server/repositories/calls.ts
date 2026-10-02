import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { calls, contacts } from "@/db/schema";

export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;
export type CallWithContact = Call & { contactName: string };

const baseSelect = {
  call: calls,
  contactName: contacts.name,
};

function toJoined(row: { call: Call; contactName: string }): CallWithContact {
  return { ...row.call, contactName: row.contactName };
}

export async function findManyByCompanyIds(companyIds: string[]): Promise<CallWithContact[]> {
  if (companyIds.length === 0) return [];
  const rows = await getDb()
    .select(baseSelect)
    .from(calls)
    .innerJoin(contacts, eq(calls.contactId, contacts.id))
    .where(inArray(calls.companyId, companyIds))
    .orderBy(desc(calls.startedAt));
  return rows.map(toJoined);
}

export async function findManyByContactId(contactId: string): Promise<Call[]> {
  return getDb().select().from(calls).where(eq(calls.contactId, contactId)).orderBy(desc(calls.startedAt));
}

export async function create(data: NewCall): Promise<Call> {
  const [row] = await getDb().insert(calls).values(data).returning();
  return row;
}
