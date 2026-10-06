import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { campaignContacts, contacts, pipelineStages, users } from "@/db/schema";

export type CampaignContact = typeof campaignContacts.$inferSelect;
export type CampaignMemberRow = {
  id: string;
  campaignId: string;
  contactId: string;
  addedAt: Date;
  contactName: string;
  phone: string | null;
  email: string | null;
  stageKey: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  lastContactAt: Date | null;
};

export async function findByCampaignId(campaignId: string): Promise<CampaignMemberRow[]> {
  const rows = await getDb()
    .select({
      id: campaignContacts.id,
      campaignId: campaignContacts.campaignId,
      contactId: campaignContacts.contactId,
      addedAt: campaignContacts.createdAt,
      contactName: contacts.name,
      phone: contacts.phone,
      email: contacts.email,
      stageKey: pipelineStages.key,
      assignedUserId: contacts.assignedUserId,
      assignedUserName: users.fullName,
      lastContactAt: contacts.lastContactAt,
    })
    .from(campaignContacts)
    .innerJoin(contacts, eq(campaignContacts.contactId, contacts.id))
    .innerJoin(pipelineStages, eq(contacts.pipelineStageId, pipelineStages.id))
    .leftJoin(users, eq(contacts.assignedUserId, users.id))
    .where(eq(campaignContacts.campaignId, campaignId))
    .orderBy(desc(campaignContacts.createdAt));
  return rows;
}

/** Idempotent — relies on the campaign_contacts_campaign_contact_idx unique
 * index so importing the same CSV twice (or a contact already in the
 * campaign) doesn't create duplicate membership rows. */
export async function addMany(campaignId: string, contactIds: string[]): Promise<void> {
  if (contactIds.length === 0) return;
  await getDb()
    .insert(campaignContacts)
    .values(contactIds.map((contactId) => ({ campaignId, contactId })))
    .onConflictDoNothing();
}

export async function findContactIdsByCampaignId(campaignId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ contactId: campaignContacts.contactId })
    .from(campaignContacts)
    .where(eq(campaignContacts.campaignId, campaignId));
  return rows.map((r) => r.contactId);
}

export async function countMembersByCampaignIds(campaignIds: string[]): Promise<Map<string, number>> {
  if (campaignIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ campaignId: campaignContacts.campaignId })
    .from(campaignContacts)
    .where(inArray(campaignContacts.campaignId, campaignIds));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.campaignId, (counts.get(r.campaignId) ?? 0) + 1);
  return counts;
}
