import { and, desc, eq, inArray } from "drizzle-orm";
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

/** Same company-wide query as findManyByCompanyIds, narrowed to calls on
 * contacts actually assigned to this agent — the call-history counterpart
 * to contactsRepo.findManyByAssignedUserId, closing the gap where an agent's
 * "recent call history" previously showed every call in their company,
 * not just calls tied to their own assigned leads. */
export async function findManyByCompanyIdsAndAssignedUser(companyIds: string[], assignedUserId: string): Promise<CallWithContact[]> {
  if (companyIds.length === 0) return [];
  const rows = await getDb()
    .select(baseSelect)
    .from(calls)
    .innerJoin(contacts, eq(calls.contactId, contacts.id))
    .where(and(inArray(calls.companyId, companyIds), eq(contacts.assignedUserId, assignedUserId)))
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
