import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { tasks, users } from "@/db/schema";

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskWithAssignee = Task & { assignedUserName: string | null };

const OPEN_STATUSES = ["PENDING", "IN_PROGRESS"] as const;

export async function findOpenByContactId(contactId: string): Promise<TaskWithAssignee[]> {
  const rows = await getDb()
    .select({ task: tasks, assignedUserName: users.fullName })
    .from(tasks)
    .leftJoin(users, eq(tasks.assignedUserId, users.id))
    .where(and(eq(tasks.contactId, contactId), inArray(tasks.status, OPEN_STATUSES)))
    .orderBy(asc(tasks.dueAt));
  return rows.map((r) => ({ ...r.task, assignedUserName: r.assignedUserName }));
}

export async function findCompanyIdById(id: string): Promise<string | undefined> {
  const [row] = await getDb().select({ companyId: tasks.companyId }).from(tasks).where(eq(tasks.id, id)).limit(1);
  return row?.companyId;
}

export async function findById(id: string): Promise<TaskWithAssignee | undefined> {
  const [row] = await getDb()
    .select({ task: tasks, assignedUserName: users.fullName })
    .from(tasks)
    .leftJoin(users, eq(tasks.assignedUserId, users.id))
    .where(eq(tasks.id, id))
    .limit(1);
  return row ? { ...row.task, assignedUserName: row.assignedUserName } : undefined;
}

export async function create(data: NewTask): Promise<Task> {
  const [row] = await getDb().insert(tasks).values(data).returning();
  return row;
}

export async function complete(id: string): Promise<Task> {
  const [row] = await getDb()
    .update(tasks)
    .set({ status: "COMPLETED", completedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return row;
}
