import * as contactsRepo from "@/server/repositories/contacts";
import * as activitiesRepo from "@/server/repositories/activities";
import * as companiesService from "@/server/services/companies";
import { requireSession } from "@/server/services/authorization";
import { OPPORTUNITY_STAGE_KEYS, CUSTOMER_STAGE_KEYS, type Stage } from "@/lib/pipeline";
import type { KpiPeriod } from "@/server/constants";

const MONTHLY_WINDOW_MONTHS = 6;

export type KpiCompanyTotals = {
  companyId: string;
  companyName: string;
  leadsWorked: number;
  opportunities: number;
  customers: number;
};

export type KpiAgentRow = {
  userId: string;
  userName: string;
  companyId: string;
  companyName: string;
  assigned: number;
  contacted: number;
  opportunities: number;
  sales: number;
};

export type KpiMonthlyRow = {
  companyId: string;
  companyName: string;
  month: string;
  leads: number;
  conversions: number;
};

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Lower date bound for a KPI period filter — null for "ALL" (no filter).
 * All non-ALL periods run from a fixed start through "now", so a single
 * lower bound is enough (no upper bound needed). */
function sinceForPeriod(period: KpiPeriod): Date | null {
  if (period === "ALL") return null;
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  if (period === "MONTH") {
    since.setDate(1);
  } else if (period === "QUARTER") {
    since.setMonth(Math.floor(since.getMonth() / 3) * 3, 1);
  } else if (period === "YEAR") {
    since.setMonth(0, 1);
  }
  return since;
}

/** Headline stat cards + per-agent table, scoped to a period.
 *
 * "ALL" keeps the original all-time semantics: opportunities/customers are a
 * snapshot of contacts currently sitting in that pipeline bucket.
 *
 * Any other period switches to a flow definition — "opportunities generated
 * this month" means contacts that *crossed into* that stage this month (via
 * the STATUS_CHANGE activity trail), not contacts created this month that
 * happen to already be there. A contact created long before the period still
 * counts if it crossed the stage boundary during the period; "leadsWorked"
 * (new leads) is the one figure still scoped by the contact's own createdAt,
 * since that's unambiguous ("leads worked this month" = leads created this
 * month). Same for "contacted" — scoped by when the outreach activity itself
 * was logged, not when the contact was created.
 */
export async function getKpiTotals(period: KpiPeriod = "ALL"): Promise<{ byCompany: KpiCompanyTotals[]; agents: KpiAgentRow[] }> {
  await requireSession();
  const companies = await companiesService.getAllowedCompaniesForCurrentUser();
  const companyIds = companies.map((c) => c.id);
  const companyNameById = new Map(companies.map((c) => [c.id, c.name]));

  const since = sinceForPeriod(period);
  const allContacts = await contactsRepo.findManyByCompanyIds(companyIds);
  const contactedIds = new Set(await activitiesRepo.findContactedContactIds(companyIds, since ?? undefined));

  let opportunityContactIds: Set<string>;
  let customerContactIds: Set<string>;
  if (since) {
    const oppRows = await activitiesRepo.findStatusChangeContactIds(companyIds, [...OPPORTUNITY_STAGE_KEYS], since);
    const custRows = await activitiesRepo.findStatusChangeContactIds(companyIds, [...CUSTOMER_STAGE_KEYS], since);
    opportunityContactIds = new Set(oppRows.map((r) => r.contactId));
    customerContactIds = new Set(custRows.map((r) => r.contactId));
  } else {
    opportunityContactIds = new Set(allContacts.filter((c) => OPPORTUNITY_STAGE_KEYS.includes(c.stageKey as Stage)).map((c) => c.id));
    customerContactIds = new Set(allContacts.filter((c) => CUSTOMER_STAGE_KEYS.includes(c.stageKey as Stage)).map((c) => c.id));
  }

  const leadsWorkedContacts = since ? allContacts.filter((c) => c.createdAt >= since) : allContacts;

  const byCompanyMap = new Map<string, Omit<KpiCompanyTotals, "companyId" | "companyName">>();
  for (const c of leadsWorkedContacts) {
    const totals = byCompanyMap.get(c.companyId) ?? { leadsWorked: 0, opportunities: 0, customers: 0 };
    totals.leadsWorked += 1;
    byCompanyMap.set(c.companyId, totals);
  }
  for (const c of allContacts) {
    if (!opportunityContactIds.has(c.id) && !customerContactIds.has(c.id)) continue;
    const totals = byCompanyMap.get(c.companyId) ?? { leadsWorked: 0, opportunities: 0, customers: 0 };
    if (opportunityContactIds.has(c.id)) totals.opportunities += 1;
    if (customerContactIds.has(c.id)) totals.customers += 1;
    byCompanyMap.set(c.companyId, totals);
  }

  const agentMap = new Map<string, Omit<KpiAgentRow, "companyName">>();
  function getAgent(c: { assignedUserId: string | null; assignedUserName: string | null; companyId: string }) {
    if (!c.assignedUserId) return undefined;
    const key = `${c.assignedUserId}:${c.companyId}`;
    const agent = agentMap.get(key) ?? {
      userId: c.assignedUserId,
      userName: c.assignedUserName ?? "—",
      companyId: c.companyId,
      assigned: 0,
      contacted: 0,
      opportunities: 0,
      sales: 0,
    };
    agentMap.set(key, agent);
    return agent;
  }
  for (const c of leadsWorkedContacts) {
    const agent = getAgent(c);
    if (agent) agent.assigned += 1;
  }
  for (const c of allContacts) {
    const touchedThisPeriod = contactedIds.has(c.id) || opportunityContactIds.has(c.id) || customerContactIds.has(c.id);
    if (!touchedThisPeriod) continue;
    const agent = getAgent(c);
    if (!agent) continue;
    if (contactedIds.has(c.id)) agent.contacted += 1;
    if (opportunityContactIds.has(c.id)) agent.opportunities += 1;
    if (customerContactIds.has(c.id)) agent.sales += 1;
  }

  return {
    byCompany: [...byCompanyMap.entries()].map(([companyId, totals]) => ({
      companyId,
      companyName: companyNameById.get(companyId) ?? "",
      ...totals,
    })),
    agents: [...agentMap.values()].map((a) => ({ ...a, companyName: companyNameById.get(a.companyId) ?? "" })),
  };
}

/** Trailing 6-month leads/conversions trend — intentionally independent of
 * the period selector above (it's a trend-over-time view, not a point-in-time
 * total), so it's fetched once on page load and not refetched per period. */
export async function getKpiMonthlyTrend(): Promise<KpiMonthlyRow[]> {
  await requireSession();
  const companies = await companiesService.getAllowedCompaniesForCurrentUser();
  const companyIds = companies.map((c) => c.id);
  const companyNameById = new Map(companies.map((c) => [c.id, c.name]));

  const since = new Date();
  since.setMonth(since.getMonth() - (MONTHLY_WINDOW_MONTHS - 1));
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const contacts = await contactsRepo.findManyByCompanyIds(companyIds);
  const clienteChanges = await activitiesRepo.findStatusChangesToStage(companyIds, "CLIENTE", since);

  const monthlyMap = new Map<string, Omit<KpiMonthlyRow, "companyName">>();
  for (const c of contacts) {
    if (c.createdAt < since) continue;
    const key = `${c.companyId}:${monthKey(c.createdAt)}`;
    const row = monthlyMap.get(key) ?? { companyId: c.companyId, month: monthKey(c.createdAt), leads: 0, conversions: 0 };
    row.leads += 1;
    monthlyMap.set(key, row);
  }
  for (const ch of clienteChanges) {
    const key = `${ch.companyId}:${monthKey(ch.createdAt)}`;
    const row = monthlyMap.get(key) ?? { companyId: ch.companyId, month: monthKey(ch.createdAt), leads: 0, conversions: 0 };
    row.conversions += 1;
    monthlyMap.set(key, row);
  }

  return [...monthlyMap.values()].map((m) => ({ ...m, companyName: companyNameById.get(m.companyId) ?? "" }));
}

export async function getKpisForCurrentUser(): Promise<{
  byCompany: KpiCompanyTotals[];
  agents: KpiAgentRow[];
  monthly: KpiMonthlyRow[];
}> {
  const [totals, monthly] = await Promise.all([getKpiTotals("ALL"), getKpiMonthlyTrend()]);
  return { ...totals, monthly };
}
