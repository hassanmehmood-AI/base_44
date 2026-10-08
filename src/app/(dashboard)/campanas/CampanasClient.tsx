"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UploadCloud, Trash2, Plus, Download, Shuffle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SearchInput, Select, Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatCard } from "@/components/StatCard";
import { StageBadge } from "@/components/StageBadge";
import { Avatar } from "@/components/ui/Avatar";
import { useLanguage } from "@/context/LanguageContext";
import { useCompany, ALL_COMPANIES } from "@/context/CompanyContext";
import { formatRelativeTime } from "@/lib/format";
import { downloadTextFile } from "@/lib/csv";
import { parseContactImportRows, CONTACTS_IMPORT_TEMPLATE_CSV, MAX_CONTACTS_IMPORT_ROWS, type ContactImportRow } from "@/lib/contactsImport";
import { cn } from "@/lib/cn";
import type { CampaignWithJoins } from "@/server/repositories/campaigns";
import type { UserWithRole } from "@/server/repositories/users";
import type { CampaignMemberWithChannels, CampaignPageStatsByCompany } from "@/server/services/campaigns";
import { CAMPAIGN_STATUSES, type CampaignStatus } from "@/server/constants";
import {
  createCampaignAction,
  updateCampaignStatusAction,
  getCampaignOwnerOptionsAction,
  reassignCampaignManagerAction,
  importCampaignMembersAction,
  getCampaignMembersAction,
  getAssignableAgentsForCampaignAction,
  assignCampaignMemberAction,
  autoAssignCampaignLeadsAction,
  getMyTeamAction,
} from "./actions";

const STATUS_TONE: Record<CampaignStatus, "gray" | "green" | "amber" | "blue"> = {
  DRAFT: "gray",
  ACTIVE: "green",
  PAUSED: "amber",
  COMPLETED: "blue",
};

const STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
};

const STATUS_LABEL_ES: Record<CampaignStatus, string> = {
  DRAFT: "Borrador",
  ACTIVE: "Activa",
  PAUSED: "Pausada",
  COMPLETED: "Completada",
};

type CompanyOption = { id: string; name: string };

export function CampanasClient({
  campaigns,
  companies: allowedCompanies,
  stats,
  initialSelectedCampaignId,
  initialMembers,
  canAssignManager,
  canAssignAgent,
  isManager,
}: {
  campaigns: CampaignWithJoins[];
  companies: CompanyOption[];
  stats: CampaignPageStatsByCompany[];
  initialSelectedCampaignId: string | null;
  initialMembers: CampaignMemberWithChannels[];
  canAssignManager: boolean;
  canAssignAgent: boolean;
  isManager: boolean;
}) {
  const { t } = useLanguage();
  const { activeCompany } = useCompany();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(initialSelectedCampaignId);
  const [members, setMembers] = useState<CampaignMemberWithChannels[]>(initialMembers);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [canalChecked, setCanalChecked] = useState<Set<string>>(new Set());
  const [agenteChecked, setAgenteChecked] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState("");
  const [memberSearch, setMemberSearch] = useState("");

  const filteredCampaigns = useMemo(
    () => campaigns.filter((c) => activeCompany === ALL_COMPANIES || c.companyName === activeCompany),
    [campaigns, activeCompany]
  );

  const totals = useMemo(() => {
    const scoped = stats.filter((s) => activeCompany === ALL_COMPANIES || s.companyName === activeCompany);
    return scoped.reduce(
      (acc, s) => ({
        totalContacts: acc.totalContacts + s.totalContacts,
        contacted: acc.contacted + s.contacted,
        customers: acc.customers + s.customers,
        opportunities: acc.opportunities + s.opportunities,
      }),
      { totalContacts: 0, contacted: 0, customers: 0, opportunities: 0 }
    );
  }, [stats, activeCompany]);

  // Looked up from the company-scoped list (not raw `campaigns`): a campaign
  // selected before switching companies must stop showing once it's out of
  // scope, falling back to the empty state instead of another company's data.
  const selectedCampaign = filteredCampaigns.find((c) => c.id === selectedCampaignId);

  // Clears the members table (and its filters) once the selected campaign
  // falls outside the active company — otherwise the "members" badge count
  // and filter chips would keep showing stale data for a campaign that's no
  // longer even visible above.
  useEffect(() => {
    if (selectedCampaignId && !filteredCampaigns.some((c) => c.id === selectedCampaignId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets derived selection state when the active company changes it out from under us, not a reactive cascade
      setSelectedCampaignId(null);
      setMembers([]);
      setCanalChecked(new Set());
      setAgenteChecked(new Set());
      setStatusFilter("");
      setMemberSearch("");
    }
  }, [filteredCampaigns, selectedCampaignId]);

  async function selectCampaign(id: string) {
    setSelectedCampaignId(id);
    setMembers([]);
    setCanalChecked(new Set());
    setAgenteChecked(new Set());
    setStatusFilter("");
    setMemberSearch("");
    setLoadingMembers(true);
    const result = await getCampaignMembersAction(id);
    setMembers(result.members);
    setLoadingMembers(false);
  }

  async function refreshMembers() {
    if (!selectedCampaignId) return;
    const result = await getCampaignMembersAction(selectedCampaignId);
    setMembers(result.members);
  }

  const channelOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of members) for (const ch of m.channels) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [members]);

  const agentOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of members) {
      const label = m.assignedUserName ?? t("Unassigned", "Sin asignar");
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [members, t]);

  const statusOptions = useMemo(() => [...new Set(members.map((m) => m.stageKey))], [members]);

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, value: string) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  const filteredMembers = members.filter((m) => {
    const matchesSearch = m.contactName.toLowerCase().includes(memberSearch.toLowerCase());
    const matchesChannel = canalChecked.size === 0 || m.channels.some((ch) => canalChecked.has(ch));
    const agentLabel = m.assignedUserName ?? t("Unassigned", "Sin asignar");
    const matchesAgent = agenteChecked.size === 0 || agenteChecked.has(agentLabel);
    const matchesStatus = !statusFilter || m.stageKey === statusFilter;
    return matchesSearch && matchesChannel && matchesAgent && matchesStatus;
  });

  const anyFilterActive = canalChecked.size > 0 || agenteChecked.size > 0 || statusFilter.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Manage Campaigns", "Gestionar Campañas")}
        subtitle={t(
          "Import contacts and manage team prospecting",
          "Importa contactos y gestiona la prospección del equipo"
        )}
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("Total contacts", "Contactos totales")} value={totals.totalContacts.toLocaleString("en-US")} />
        <StatCard label={t("Contacted", "Contactados")} value={totals.contacted.toLocaleString("en-US")} />
        <StatCard label={t("Customers", "Clientes")} value={totals.customers.toLocaleString("en-US")} />
        <StatCard label={t("Opportunities", "Oportunidades")} value={totals.opportunities.toLocaleString("en-US")} />
      </div>

      {isManager && allowedCompanies[0] && <MyTeamCard companyId={allowedCompanies[0].id} />}

      <Card className="flex flex-col gap-4 p-5">
        <CardHeader>
          <CardTitle>{t("Campaigns", "Campañas")}</CardTitle>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> {t("New campaign", "Nueva campaña")}
          </Button>
        </CardHeader>

        {filteredCampaigns.length === 0 ? (
          <p className="py-6 text-center text-[13.5px] text-text-tertiary">
            {t("No campaigns yet. Create the first one.", "Aún no hay campañas. Crea la primera.")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredCampaigns.map((c) => (
              <CampaignRow
                key={c.id}
                campaign={c}
                selected={c.id === selectedCampaignId}
                onSelect={() => selectCampaign(c.id)}
                canAssignManager={canAssignManager}
              />
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr_280px]">
        <ImportMembersPanel
          selectedCampaign={selectedCampaign}
          onImported={refreshMembers}
        />

        <Card className="flex flex-col gap-4 p-5">
          <CardHeader>
            <CardTitle>{t("Campaign members", "Miembros de campaña")}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge tone="green">
                {filteredMembers.length} {t("members", "miembros")}
              </Badge>
              {canAssignAgent && selectedCampaign && (
                <AutoAssignLeadsButton campaign={selectedCampaign} members={members} onAssigned={refreshMembers} />
              )}
            </div>
          </CardHeader>

          {!selectedCampaign ? (
            <p className="py-6 text-center text-[13.5px] text-text-tertiary">
              {t("Select a campaign above to view its members.", "Selecciona una campaña arriba para ver sus miembros.")}
            </p>
          ) : (
            <>
              <SearchInput
                placeholder={t("Search...", "Buscar...")}
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
              />

              {loadingMembers ? (
                <p className="py-6 text-center text-[13.5px] text-text-tertiary">{t("Loading...", "Cargando...")}</p>
              ) : members.length === 0 ? (
                <p className="py-6 text-center text-[13.5px] text-text-tertiary">
                  {t("No members yet. Import a CSV on the left.", "Aún no hay miembros. Importa un CSV a la izquierda.")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-left">
                    <thead>
                      <tr className="text-[11px] font-semibold tracking-wide text-text-tertiary">
                        <th className="pb-3 pr-4">{t("CLIENT", "CLIENTE")}</th>
                        <th className="pb-3 pr-4">{t("AGENT", "AGENTE")}</th>
                        <th className="pb-3 pr-4">{t("CHANNELS", "CANALES")}</th>
                        <th className="pb-3 pr-4">{t("STATUS", "ESTADO")}</th>
                        <th className="pb-3">{t("LAST CONTACT", "ÚLTIMO CONTACTO")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMembers.map((m) => (
                        <tr key={m.id} className="border-t border-border text-[13.5px] transition-colors hover:bg-surface-muted/70">
                          <td className="py-3.5 pr-4 font-medium text-text-primary">{m.contactName}</td>
                          <td className="py-3.5 pr-4 text-text-secondary">
                            {canAssignAgent && selectedCampaign ? (
                              <MemberAssignAgentSelect
                                companyId={selectedCampaign.companyId}
                                member={m}
                                onAssigned={refreshMembers}
                              />
                            ) : (
                              m.assignedUserName ?? t("Unassigned", "Sin asignar")
                            )}
                          </td>
                          <td className="py-3.5 pr-4 text-text-secondary">{m.channels.length > 0 ? m.channels.join(", ") : "—"}</td>
                          <td className="py-3.5 pr-4">
                            <StageBadge stage={m.stageKey} />
                          </td>
                          <td className="py-3.5 text-text-secondary">{formatRelativeTime(m.lastContactAt, "en")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Card>

        <Card className="flex flex-col gap-5 p-5">
          <CardHeader>
            <CardTitle>{t("Filters", "Filtros")}</CardTitle>
            {anyFilterActive && (
              <button
                onClick={() => {
                  setCanalChecked(new Set());
                  setAgenteChecked(new Set());
                  setStatusFilter("");
                }}
                className="flex items-center gap-1 text-[12.5px] font-medium text-text-secondary hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" /> {t("Clear", "Limpiar")}
              </button>
            )}
          </CardHeader>

          <div>
            <p className="mb-2.5 text-[11px] font-semibold tracking-wide text-text-tertiary">
              {t("CHANNEL", "CANAL")}
            </p>
            {channelOptions.length === 0 ? (
              <p className="text-[12.5px] text-text-tertiary">{t("No data yet.", "Aún no hay datos.")}</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {channelOptions.map(([channel, count]) => (
                  <label key={channel} className="flex cursor-pointer items-center justify-between text-[13.5px]">
                    <span className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand"
                        checked={canalChecked.has(channel)}
                        onChange={() => toggle(canalChecked, setCanalChecked, channel)}
                      />
                      {channel}
                    </span>
                    <span className="text-text-tertiary">{count}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="mb-2.5 text-[11px] font-semibold tracking-wide text-text-tertiary">
              {t("COMMERCIAL AGENT", "AGENTE COMERCIAL")}
            </p>
            {agentOptions.length === 0 ? (
              <p className="text-[12.5px] text-text-tertiary">{t("No data yet.", "Aún no hay datos.")}</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {agentOptions.map(([agent, count]) => (
                  <label key={agent} className="flex cursor-pointer items-center justify-between text-[13.5px]">
                    <span className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand"
                        checked={agenteChecked.has(agent)}
                        onChange={() => toggle(agenteChecked, setAgenteChecked, agent)}
                      />
                      {agent}
                    </span>
                    <span className="text-text-tertiary">{count}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-tertiary">
              {t("STATUS", "ESTADO")}
            </p>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t("All statuses", "Todos los estados")}</option>
              {statusOptions.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </Select>
          </div>
        </Card>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t("New campaign", "Nueva campaña")}>
        <CreateCampaignForm companies={allowedCompanies} onClose={() => setCreateOpen(false)} />
      </Modal>
    </div>
  );
}

/** "My Team" card: a Call Center Manager's own agents, always visible on
 * their Manage Campaigns page (not just inside an admin-only settings
 * screen). Read-only here — managing the team itself still happens in
 * Settings > Users. Scoped to one company: a manager has exactly one in the
 * normal business flow (see plan.md), same simplification already used by
 * the Settings > Users "Manager"/"Team" panels. */
function MyTeamCard({ companyId }: { companyId: string }) {
  const { t } = useLanguage();
  const [team, setTeam] = useState<{ id: string; fullName: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getMyTeamAction(companyId).then((res) => {
      if (active) {
        setTeam(res.team);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [companyId]);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <CardHeader>
        <CardTitle>{t("My Team", "Mi Equipo")}</CardTitle>
        <Badge tone="green">
          {team.length} {t(`agent${team.length === 1 ? "" : "s"}`, `agente${team.length === 1 ? "" : "s"}`)}
        </Badge>
      </CardHeader>

      {loading ? (
        <p className="py-2 text-center text-[13.5px] text-text-tertiary">{t("Loading...", "Cargando...")}</p>
      ) : team.length === 0 ? (
        <p className="py-2 text-center text-[13.5px] text-text-tertiary">
          {t(
            "No agents assigned to you yet. Ask a Director or Superuser to link an agent to you in Settings > Users.",
            "Todavía no tienes agentes asignados. Pide a un Director o Superusuario que te vincule un agente en Configuración > Usuarios."
          )}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2.5">
          {team.map((a) => (
            <div key={a.id} className="flex items-center gap-2.5 rounded-lg bg-surface-muted px-3 py-2">
              <Avatar name={a.fullName} size={28} />
              <span className="text-[13.5px] font-medium text-text-primary">{a.fullName}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CampaignRow({
  campaign,
  selected,
  onSelect,
  canAssignManager,
}: {
  campaign: CampaignWithJoins;
  selected: boolean;
  onSelect: () => void;
  canAssignManager: boolean;
}) {
  const { t, language } = useLanguage();
  const statusLabels = language === "es" ? STATUS_LABEL_ES : STATUS_LABEL;
  const [status, setStatus] = useState(campaign.status as CampaignStatus);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleStatusChange(next: CampaignStatus) {
    setPending(true);
    setError(undefined);
    const result = await updateCampaignStatusAction(campaign.id, next);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setStatus(next);
  }

  return (
    <div
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-colors",
        selected ? "border-brand-100 bg-brand-50" : "border-border hover:bg-surface-muted"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14px] font-semibold text-text-primary">{campaign.name}</p>
          <Badge tone={STATUS_TONE[status]}>{statusLabels[status]}</Badge>
        </div>
        <p className="truncate text-[12.5px] text-text-secondary">
          {campaign.companyName}
          {campaign.objective ? ` · ${campaign.objective}` : ""}
          {campaign.ownerName ? ` · ${t("Manager", "Gerente")}: ${campaign.ownerName}` : ""}
        </p>
        {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {canAssignManager && <ManagerAssignSelect campaign={campaign} />}
        <div className="w-[150px]">
          <Select value={status} disabled={pending} onChange={(e) => handleStatusChange(e.target.value as CampaignStatus)}>
            {CAMPAIGN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
}

/** Director/Superuser-only control: reassigns which Call Center Manager owns
 * this campaign. Options are scoped to this campaign's own company, lazily
 * fetched on mount (not every campaign row needs this unless the viewer can
 * actually use it — canAssignManager already gates whether this renders). */
function ManagerAssignSelect({ campaign }: { campaign: CampaignWithJoins }) {
  const { t } = useLanguage();
  const [managers, setManagers] = useState<{ id: string; fullName: string }[]>([]);
  const [ownerId, setOwnerId] = useState(campaign.ownerId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    getCampaignOwnerOptionsAction(campaign.companyId).then((res) => {
      if (active) setManagers(res.users);
    });
    return () => {
      active = false;
    };
  }, [campaign.companyId]);

  async function handleChange(next: string) {
    const previous = ownerId;
    setOwnerId(next);
    setPending(true);
    setError(undefined);
    const result = await reassignCampaignManagerAction(campaign.id, next);
    setPending(false);
    if (result.error) {
      setError(result.error);
      setOwnerId(previous);
    }
  }

  return (
    <div className="w-[170px]">
      <Select value={ownerId} disabled={pending} onChange={(e) => handleChange(e.target.value)}>
        <option value="">{t("Unassigned", "Sin asignar")}</option>
        {managers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.fullName}
          </option>
        ))}
      </Select>
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  );
}

/** Campaign Members table's per-lead "Assign Agent" (hierarchy redesign
 * phase 5) — reuses the same scoped options and assignContact() write path
 * as the CRM's own Assign Agent action (phase 4), just a different entry
 * point. Options are scoped per company, fetched once per row on mount. */
function MemberAssignAgentSelect({
  companyId,
  member,
  onAssigned,
}: {
  companyId: string;
  member: CampaignMemberWithChannels;
  onAssigned: () => void;
}) {
  const { t } = useLanguage();
  const [agents, setAgents] = useState<{ id: string; fullName: string }[]>([]);
  const [assignedUserId, setAssignedUserId] = useState(member.assignedUserId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    getAssignableAgentsForCampaignAction(companyId).then((res) => {
      if (active) setAgents(res.users);
    });
    return () => {
      active = false;
    };
  }, [companyId]);

  async function handleChange(next: string) {
    const previous = assignedUserId;
    setAssignedUserId(next);
    setPending(true);
    setError(undefined);
    const result = await assignCampaignMemberAction(member.contactId, next);
    setPending(false);
    if (result.error) {
      setError(result.error);
      setAssignedUserId(previous);
      return;
    }
    onAssigned();
  }

  return (
    <div className="min-w-[150px]" onClick={(e) => e.stopPropagation()}>
      <Select value={assignedUserId} disabled={pending} onChange={(e) => handleChange(e.target.value)}>
        <option value="">{t("Unassigned", "Sin asignar")}</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.fullName}
          </option>
        ))}
      </Select>
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  );
}

/** "Auto Assign Leads" (hierarchy redesign phase 6) — manager-scoped,
 * per-campaign Round Robin for this campaign's currently unassigned leads.
 * The unassigned count shown in the confirm step comes from the already-
 * loaded members list (no extra round trip, and always accurate for the
 * viewer); the agent count in the success summary comes back from the
 * action itself, since that's computed from the campaign's actual manager
 * team server-side, not necessarily the viewer's own. */
function AutoAssignLeadsButton({
  campaign,
  members,
  onAssigned,
}: {
  campaign: CampaignWithJoins;
  members: CampaignMemberWithChannels[];
  onAssigned: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ assigned: number; agentCount: number; message?: string } | undefined>();
  const [error, setError] = useState<string | undefined>();

  const unassignedCount = members.filter((m) => !m.assignedUserId).length;

  function handleOpen() {
    setResult(undefined);
    setError(undefined);
    setOpen(true);
  }

  async function handleConfirm() {
    setPending(true);
    setError(undefined);
    const res = await autoAssignCampaignLeadsAction(campaign.id);
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setResult({ assigned: res.assigned ?? 0, agentCount: res.agentCount ?? 0, message: res.message });
    onAssigned();
  }

  return (
    <>
      <Button variant="outline" onClick={handleOpen} disabled={unassignedCount === 0}>
        <Shuffle className="h-4 w-4" /> {t("Auto Assign Leads", "Asignar automáticamente")}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("Auto Assign Leads", "Asignar automáticamente")}>
        {result ? (
          <div className="flex flex-col gap-4">
            {result.message ? (
              <p className="text-[13.5px] text-text-secondary">{result.message}</p>
            ) : (
              <p className="text-[14px] font-semibold text-text-primary">
                {t(
                  `${result.assigned} lead${result.assigned === 1 ? "" : "s"} assigned across ${result.agentCount} agent${result.agentCount === 1 ? "" : "s"} successfully.`,
                  `${result.assigned} lead${result.assigned === 1 ? "" : "s"} asignado${result.assigned === 1 ? "" : "s"} entre ${result.agentCount} agente${result.agentCount === 1 ? "" : "s"} exitosamente.`
                )}
              </p>
            )}
            <Button onClick={() => setOpen(false)} className="w-full">
              {t("Close", "Cerrar")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-[13.5px] text-text-secondary">
              {t(
                `This will distribute ${unassignedCount} unassigned lead${unassignedCount === 1 ? "" : "s"} in "${campaign.name}" across this campaign's active agents using Round Robin. Already-assigned leads are never touched.`,
                `Esto distribuirá ${unassignedCount} lead${unassignedCount === 1 ? "" : "s"} sin asignar en "${campaign.name}" entre los agentes activos de esta campaña usando Round Robin. Los leads ya asignados nunca se modifican.`
              )}
            </p>
            {error && <p className="text-[13px] text-danger">{error}</p>}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("Cancel", "Cancelar")}
              </Button>
              <Button onClick={handleConfirm} disabled={pending}>
                {pending ? t("Assigning...", "Asignando...") : t("Auto Assign Leads", "Asignar automáticamente")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function CreateCampaignForm({ companies, onClose }: { companies: CompanyOption[]; onClose: () => void }) {
  const { t } = useLanguage();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [owners, setOwners] = useState<UserWithRole[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleCompanyChange(id: string) {
    setCompanyId(id);
    setOwnerId("");
    if (!id) {
      setOwners([]);
      return;
    }
    const result = await getCampaignOwnerOptionsAction(id);
    setOwners(result.users);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    const result = await createCampaignAction({ companyId, name, objective, ownerId });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onClose();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
          {t("COMPANY", "EMPRESA")}
        </label>
        <Select value={companyId} onChange={(e) => handleCompanyChange(e.target.value)} required>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
          {t("CAMPAIGN NAME", "NOMBRE DE LA CAMPAÑA")}
        </label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
          {t("OBJECTIVE", "OBJETIVO")}
        </label>
        <Textarea rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} />
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
          {t("MANAGER", "GERENTE")}
        </label>
        <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">{t("Unassigned", "Sin asignar")}</option>
          {owners.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </Select>
      </div>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <Button type="submit" disabled={saving} className="mt-1 w-full">
        {saving ? t("Creating...", "Creando...") : t("Create campaign", "Crear campaña")}
      </Button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// CSV member import — same parsing/preview flow as the CRM contacts import
// (see @/lib/contactsImport), scoped to whichever campaign is selected above.
// -----------------------------------------------------------------------------

function ImportMembersPanel({
  selectedCampaign,
  onImported,
}: {
  selectedCampaign: CampaignWithJoins | undefined;
  onImported: () => void;
}) {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ContactImportRow[] | null>(null);
  const [fileError, setFileError] = useState<string | undefined>();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<number | null>(null);

  const validRows = rows?.filter((r) => r.valid) ?? [];
  const invalidCount = (rows?.length ?? 0) - validRows.length;
  const truncated = validRows.length > MAX_CONTACTS_IMPORT_ROWS;

  function handleDownloadTemplate() {
    downloadTextFile(CONTACTS_IMPORT_TEMPLATE_CSV, "contacts-template.csv");
  }

  function reset() {
    setFileName("");
    setRows(null);
    setFileError(undefined);
    setError(undefined);
    setResult(null);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileName(file.name);
    setRows(null);
    setFileError(undefined);
    setError(undefined);
    setResult(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const { rows: parsed, error: parseError } = parseContactImportRows(text, t);
      if (parseError) {
        setFileError(parseError);
        return;
      }
      setRows(parsed);
    };
    reader.onerror = () => setFileError(t("Could not read that file.", "No se pudo leer el archivo."));
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!selectedCampaign) return;
    setImporting(true);
    setError(undefined);
    const rowsToSend = validRows.slice(0, MAX_CONTACTS_IMPORT_ROWS).map((r) => ({
      name: r.name,
      businessName: r.businessName,
      phone: r.phone,
      email: r.email,
      leadSource: r.leadSource,
    }));
    const res = await importCampaignMembersAction(selectedCampaign.id, rowsToSend);
    setImporting(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setResult(res.created ?? 0);
    onImported();
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <CardHeader>
        <CardTitle>{t("Import members", "Importar miembros")}</CardTitle>
      </CardHeader>

      {!selectedCampaign ? (
        <p className="py-6 text-center text-[13.5px] text-text-tertiary">
          {t("Select a campaign above to import contacts into it.", "Selecciona una campaña arriba para importar contactos.")}
        </p>
      ) : result !== null ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-[14px] font-semibold text-text-primary">
            {t(`${result} contact${result === 1 ? "" : "s"} imported.`, `${result} contacto${result === 1 ? "" : "s"} importado${result === 1 ? "" : "s"}.`)}
          </p>
          <Button onClick={reset}>{t("Import more", "Importar más")}</Button>
        </div>
      ) : rows ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-text-secondary">{fileName}</p>
          <p className="text-[13px] text-text-primary">
            {t(`${validRows.length} valid row${validRows.length === 1 ? "" : "s"}`, `${validRows.length} fila${validRows.length === 1 ? "" : "s"} válida${validRows.length === 1 ? "" : "s"}`)}
            {invalidCount > 0 && (
              <span className="text-text-tertiary"> · {t(`${invalidCount} skipped`, `${invalidCount} omitidas`)}</span>
            )}
          </p>
          {truncated && (
            <p className="text-[12px] text-warning-700">
              {t(
                `Only the first ${MAX_CONTACTS_IMPORT_ROWS} valid rows will be imported.`,
                `Solo se importarán las primeras ${MAX_CONTACTS_IMPORT_ROWS} filas válidas.`
              )}
            </p>
          )}
          {error && <p className="text-[13px] text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" onClick={reset} className="flex-1">
              {t("Cancel", "Cancelar")}
            </Button>
            <Button disabled={validRows.length === 0 || importing} onClick={handleImport} className="flex-1">
              {importing
                ? t("Importing...", "Importando...")
                : t(`Import ${Math.min(validRows.length, MAX_CONTACTS_IMPORT_ROWS)} contacts`, `Importar ${Math.min(validRows.length, MAX_CONTACTS_IMPORT_ROWS)} contactos`)}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-8 text-center transition-colors hover:border-brand hover:bg-brand-50/40"
          >
            <UploadCloud className="h-6 w-6 text-brand" />
            <span className="text-[14px] font-semibold text-text-primary">
              {t("Import Excel or CSV", "Importar Excel o CSV")}
            </span>
            <span className="text-[12.5px] text-text-secondary">
              {t("Click to choose a file", "Haz clic para elegir un archivo")}
            </span>
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          {fileError && <p className="text-[12.5px] text-danger">{fileError}</p>}
          <button
            onClick={handleDownloadTemplate}
            className="flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-text-secondary hover:text-brand-700"
          >
            <Download className="h-3.5 w-3.5" /> {t("Download CSV template", "Descargar plantilla CSV")}
          </button>
        </div>
      )}
    </Card>
  );
}
