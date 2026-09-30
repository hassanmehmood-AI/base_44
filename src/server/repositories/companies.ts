import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { companies } from "@/db/schema";

export type Company = typeof companies.$inferSelect;

export async function findAllActive(): Promise<Company[]> {
  return getDb().select().from(companies).where(eq(companies.isActive, true)).orderBy(companies.name);
}

export async function findByIds(ids: string[]): Promise<Company[]> {
  if (ids.length === 0) return [];
  return getDb().select().from(companies).where(inArray(companies.id, ids));
}

export async function findById(id: string): Promise<Company | undefined> {
  const [row] = await getDb().select().from(companies).where(eq(companies.id, id)).limit(1);
  return row;
}

export async function existsByName(name: string): Promise<boolean> {
  const [row] = await getDb().select({ id: companies.id }).from(companies).where(eq(companies.name, name)).limit(1);
  return !!row;
}

export async function create(input: { name: string; slug: string }): Promise<Company> {
  const [row] = await getDb().insert(companies).values(input).returning();
  return row;
}
