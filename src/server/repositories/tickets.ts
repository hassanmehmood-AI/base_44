import { desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { tickets, companies, users } from "@/db/schema";

export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type TicketWithJoins = Ticket & {
  companyName: string;
  createdByName: string;
  assigneeName: string | null;
};

const createdByUser = alias(users, "created_by_user");
const assigneeUser = alias(users, "assignee_user");

const baseSelect = {
  ticket: tickets,
  companyName: companies.name,
  createdByName: createdByUser.fullName,
  assigneeName: assigneeUser.fullName,
};

function toJoined(row: {
  ticket: Ticket;
  companyName: string;
  createdByName: string;
  assigneeName: string | null;
}): TicketWithJoins {
  return { ...row.ticket, companyName: row.companyName, createdByName: row.createdByName, assigneeName: row.assigneeName };
}

function baseQuery() {
  return getDb()
    .select(baseSelect)
    .from(tickets)
    .innerJoin(companies, eq(tickets.companyId, companies.id))
    .innerJoin(createdByUser, eq(tickets.createdBy, createdByUser.id))
    .leftJoin(assigneeUser, eq(tickets.assigneeId, assigneeUser.id));
}

export async function findManyByCompanyIds(companyIds: string[]): Promise<TicketWithJoins[]> {
  if (companyIds.length === 0) return [];
  const rows = await baseQuery().where(inArray(tickets.companyId, companyIds)).orderBy(desc(tickets.createdAt));
  return rows.map(toJoined);
}

export async function findById(id: string): Promise<TicketWithJoins | undefined> {
  const [row] = await baseQuery().where(eq(tickets.id, id)).limit(1);
  return row ? toJoined(row) : undefined;
}

export async function findCompanyIdById(id: string): Promise<string | undefined> {
  const [row] = await getDb().select({ companyId: tickets.companyId }).from(tickets).where(eq(tickets.id, id)).limit(1);
  return row?.companyId;
}

export async function create(data: NewTicket): Promise<Ticket> {
  const [row] = await getDb().insert(tickets).values(data).returning();
  return row;
}

export async function updateStatus(id: string, status: string): Promise<Ticket> {
  const extra: Partial<Ticket> = {};
  if (status === "RESOLVED") extra.resolvedAt = new Date();
  if (status === "CLOSED") extra.closedAt = new Date();
  const [row] = await getDb()
    .update(tickets)
    .set({ status, ...extra })
    .where(eq(tickets.id, id))
    .returning();
  return row;
}

export async function updateAssignee(id: string, assigneeId: string | null): Promise<Ticket> {
  const [row] = await getDb().update(tickets).set({ assigneeId }).where(eq(tickets.id, id)).returning();
  return row;
}
