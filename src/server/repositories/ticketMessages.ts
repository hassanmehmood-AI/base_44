import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ticketMessages, users } from "@/db/schema";

export type TicketMessage = typeof ticketMessages.$inferSelect;
export type NewTicketMessage = typeof ticketMessages.$inferInsert;
export type TicketMessageWithAuthor = TicketMessage & { authorName: string };

export async function findByTicketId(ticketId: string): Promise<TicketMessageWithAuthor[]> {
  const rows = await getDb()
    .select({ message: ticketMessages, authorName: users.fullName })
    .from(ticketMessages)
    .innerJoin(users, eq(ticketMessages.authorId, users.id))
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(asc(ticketMessages.createdAt));
  return rows.map((r) => ({ ...r.message, authorName: r.authorName }));
}

export async function create(data: NewTicketMessage): Promise<TicketMessage> {
  const [row] = await getDb().insert(ticketMessages).values(data).returning();
  return row;
}
