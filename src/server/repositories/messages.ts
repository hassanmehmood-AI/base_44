import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export async function findByConversationId(conversationId: string): Promise<Message[]> {
  return getDb().select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.sentAt));
}

/** Active Campaigns page channel summary: bulk fetch across many conversations
 * at once (one query per channel) rather than N+1'ing findByConversationId. */
export async function findByConversationIds(conversationIds: string[]): Promise<Message[]> {
  if (conversationIds.length === 0) return [];
  return getDb().select().from(messages).where(inArray(messages.conversationId, conversationIds)).orderBy(asc(messages.sentAt));
}

/** Append-only insert — messages has no update/delete by design (see §9's
 * append-only-timeline rule, same pattern as activities/ticket_messages). */
export async function create(data: NewMessage): Promise<Message> {
  const [row] = await getDb().insert(messages).values(data).returning();
  return row;
}
