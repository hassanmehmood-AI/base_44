import * as contactsRepo from "@/server/repositories/contacts";
import * as conversationsRepo from "@/server/repositories/conversations";
import * as messagesRepo from "@/server/repositories/messages";
import * as callsRepo from "@/server/repositories/calls";
import * as pipelineStagesRepo from "@/server/repositories/pipelineStages";
import * as companiesService from "@/server/services/companies";
import * as contactsService from "@/server/services/contacts";
import { requireSession } from "@/server/services/authorization";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export type AssignedClient = {
  id: string;
  name: string;
  businessName: string | null;
  companyName: string;
  assignedUserName: string | null;
  stageKey: string;
  /** Real signal for the "active" dot: this client has a follow-up that's due now or overdue. */
  needsFollowUp: boolean;
};

/** "My assigned clients" panel: every contact across the companies the
 * current user can see, not pre-filtered to "assigned to me" — the Active
 * Campaigns page filters by agent client-side (same company-filter pattern
 * as every other migrated page) so a lead/director can switch between agents
 * without a extra round trip. */
export async function getAssignedClientsForCurrentUser(): Promise<AssignedClient[]> {
  await requireSession();
  const allowed = await companiesService.getAllowedCompaniesForCurrentUser();
  const contacts = await contactsRepo.findManyByCompanyIds(allowed.map((c) => c.id));
  const now = startOfToday();

  return contacts.map((c) => ({
    id: c.id,
    name: c.name,
    businessName: c.businessName,
    companyName: c.companyName,
    assignedUserName: c.assignedUserName,
    stageKey: c.stageKey,
    needsFollowUp: !!c.followUpAt && c.followUpAt <= now,
  }));
}

type ChannelCounts = { unread: number; repliesToday: number; pending: number };
type CallCounts = { callsToday: number; answered: number; callbacks: number };

export type ChannelSummaryByCompany = {
  companyId: string;
  companyName: string;
  whatsapp: ChannelCounts;
  email: ChannelCounts;
  calls: CallCounts;
};

/** Per-conversation "unread"/"pending" aren't stored fields (no read receipts
 * in the schema) — unread/pending here means "the customer's last message
 * has no agent reply yet", derived from the real message timeline, same as
 * any inbox would show at a glance. */
async function summarizeConversations(companyIds: string[], channel: string): Promise<Map<string, ChannelCounts>> {
  const byCompany = new Map<string, ChannelCounts>();
  if (companyIds.length === 0) return byCompany;

  const conversations = await conversationsRepo.findManyByCompanyIdsAndChannel(companyIds, channel);
  const allMessages = await messagesRepo.findByConversationIds(conversations.map((c) => c.id));

  const messagesByConversation = new Map<string, typeof allMessages>();
  for (const m of allMessages) {
    const list = messagesByConversation.get(m.conversationId) ?? [];
    list.push(m);
    messagesByConversation.set(m.conversationId, list);
  }

  const today = startOfToday();
  for (const conv of conversations) {
    const counts = byCompany.get(conv.companyId) ?? { unread: 0, repliesToday: 0, pending: 0 };
    const msgs = messagesByConversation.get(conv.id) ?? []; // already sorted ascending by sentAt

    const hasOutbound = msgs.some((m) => m.direction === "OUTBOUND");
    const last = msgs[msgs.length - 1];
    if (last && last.direction === "INBOUND") counts.unread += 1;
    if (!hasOutbound) counts.pending += 1;
    counts.repliesToday += msgs.filter((m) => m.direction === "OUTBOUND" && m.sentAt >= today).length;

    byCompany.set(conv.companyId, counts);
  }
  return byCompany;
}

async function summarizeCalls(companyIds: string[]): Promise<Map<string, CallCounts>> {
  const byCompany = new Map<string, CallCounts>();
  if (companyIds.length === 0) return byCompany;

  const calls = await callsRepo.findManyByCompanyIds(companyIds);
  const today = startOfToday();

  for (const call of calls) {
    if (call.startedAt < today) continue;
    const counts = byCompany.get(call.companyId) ?? { callsToday: 0, answered: 0, callbacks: 0 };
    counts.callsToday += 1;
    if (call.status === "COMPLETED") counts.answered += 1;
    if (call.status === "MISSED" || call.status === "NO_ANSWER") counts.callbacks += 1;
    byCompany.set(call.companyId, counts);
  }
  return byCompany;
}

const EMPTY_CHANNEL: ChannelCounts = { unread: 0, repliesToday: 0, pending: 0 };
const EMPTY_CALLS: CallCounts = { callsToday: 0, answered: 0, callbacks: 0 };

/** Channel summary cards on the Active Campaigns page, broken down per
 * company so the client can re-filter by the header's company selector
 * without refetching (same pattern as campaigns.getCampaignPageStats). */
export async function getChannelSummaryForCurrentUser(): Promise<ChannelSummaryByCompany[]> {
  await requireSession();
  const allowed = await companiesService.getAllowedCompaniesForCurrentUser();
  const companyIds = allowed.map((c) => c.id);

  const [whatsappByCompany, emailByCompany, callsByCompany] = await Promise.all([
    summarizeConversations(companyIds, "WHATSAPP"),
    summarizeConversations(companyIds, "EMAIL"),
    summarizeCalls(companyIds),
  ]);

  return allowed.map((c) => ({
    companyId: c.id,
    companyName: c.name,
    whatsapp: whatsappByCompany.get(c.id) ?? EMPTY_CHANNEL,
    email: emailByCompany.get(c.id) ?? EMPTY_CHANNEL,
    calls: callsByCompany.get(c.id) ?? EMPTY_CALLS,
  }));
}

/** "New contact" on the Active Campaigns page: always lands in the pipeline's
 * entry stage and is assigned straight to whoever created it — this page is
 * framed around "my assigned clients", so a contact added here should show
 * up there immediately without a separate assignment step. */
export async function createAssignedContact(input: {
  companyId: string;
  name: string;
  businessName?: string | null;
  phone?: string | null;
  email?: string | null;
}) {
  const session = await requireSession();
  const stages = await pipelineStagesRepo.findDefaultPipelineStages();
  const entryStage = stages.find((s) => s.isActive) ?? stages[0];
  if (!entryStage) throw new Error("No pipeline stage configured.");

  return contactsService.createContact({
    companyId: input.companyId,
    name: input.name,
    businessName: input.businessName ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    pipelineStageId: entryStage.id,
    assignedUserId: session.user.id,
  });
}
