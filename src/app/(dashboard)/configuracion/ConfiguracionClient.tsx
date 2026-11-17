"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, CheckCircle2, Trash2, RotateCcw, ArrowUp, ArrowDown, Power, Building2, Mail, Unlink, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SearchInput, Select, Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/PageHeader";
import { useLanguage } from "@/context/LanguageContext";
import { STAGE_LABEL, STAGE_LABEL_ES, Stage } from "@/lib/pipeline";
import { cn } from "@/lib/cn";
import type { PipelineStage } from "@/server/repositories/pipelineStages";
import type { Company } from "@/server/repositories/companies";
import { ROLE_KEYS, MODULE_KEYS, type RoleKey, type ModuleKey } from "@/server/constants";
import { ROLE_LABEL, ROLE_LABEL_ES } from "@/lib/roles";
import {
  toggleStageActiveAction,
  moveStageAction,
  createCompanyAction,
  createUserAction,
  getUserAccessAction,
  updateUserPermissionsAction,
  resetUserPermissionsToRoleDefaultAction,
  updateUserRoleAction,
  deactivateUserAction,
  getManagersForCompanyAction,
  getAgentManagerAction,
  getManagerTeamAction,
  setAgentManagerAction,
  retryMetricoolProvisioningAction,
  generateMetricoolConnectionLinkAction,
  listLinkableMetricoolBrandsAction,
  linkExistingMetricoolBrandAction,
  getLiveMetricoolConnectionStatusAction,
  createWhapiChannelAction,
  retryWhapiChannelCreationAction,
  confirmNoWhapiChannelWasCreatedAction,
  getLiveWhapiChannelStatusAction,
  getWhapiQrAction,
  getGoogleAuthorizationUrlAction,
  getGoogleEmailAccountsForCompanyAction,
  disconnectGoogleEmailAccountAction,
  type GoogleEmailAccountRow,
  testWebmailConnectionAction,
  connectWebmailAccountAction,
  getWebmailAccountsForCompanyAction,
  disconnectWebmailAccountAction,
  type WebmailAccountRow,
  getZadarmaCountriesAction,
  getZadarmaDestinationsAction,
  getZadarmaAvailableNumbersAction,
  checkZadarmaBalanceAction,
  getZadarmaDocumentGroupsAction,
  createZadarmaDocumentGroupAction,
  purchaseZadarmaNumberAction,
  retryZadarmaPurchaseAction,
  confirmNoZadarmaChargeOccurredAction,
  getZadarmaNumbersListAction,
  reassignZadarmaNumberAction,
  linkExistingZadarmaNumberAction,
  type ZadarmaNumberStatus,
  type ZadarmaNumberRow,
  type ZadarmaErrorReason,
  getZadarmaExtensionLimitCheckAction,
  getZadarmaExtensionsListAction,
  getZadarmaAssignableAgentsAction,
  createZadarmaExtensionAction,
  connectExistingZadarmaExtensionAction,
  retryZadarmaExtensionAction,
  confirmNoZadarmaExtensionChargeAction,
  reassignZadarmaExtensionAction,
  revokeZadarmaExtensionAction,
  reactivateZadarmaExtensionAction,
  type ZadarmaExtensionRow,
  type ZadarmaExtensionErrorReason,
} from "./actions";
import type { SmtpImapInput } from "@/server/services/smtpOnboarding";
import type { CompanyProvisioningStatus, LinkableBrand } from "@/server/services/metricoolOnboarding";
import type { CompanyChannelStatus as WhapiChannelStatus } from "@/server/services/whapiOnboarding";
import type { ZadarmaCountry, ZadarmaDestination, ZadarmaAvailableNumber, ZadarmaDocumentGroup } from "@/server/integrations/zadarma";

export type UserRow = {
  id: string;
  fullName: string;
  email: string;
  roleKey: RoleKey;
  isActive: boolean;
  // Agent Online button — null for every role except CALL_CENTER_AGENT (the
  // only role setMyOnlineStatus ever lets set this). A simple manual
  // self-reported signal, not a connection/heartbeat check.
  isOnline: boolean | null;
};

const MODULE_LABEL: Record<ModuleKey, string> = {
  PROSPECTING: "Prospecting",
  CRM: "CRM",
  CHANNELS: "Channels",
  KPIS: "KPI's",
  USER_ROLE_MANAGEMENT: "User & role management",
  MANAGE_CAMPAIGNS: "Manage Campaigns",
  ACTIVE_CAMPAIGNS: "Active Campaigns",
  TECHNICAL_SUPPORT: "Technical Support",
};

const MODULE_LABEL_ES: Record<ModuleKey, string> = {
  PROSPECTING: "Prospección",
  CRM: "CRM",
  CHANNELS: "Canales",
  KPIS: "KPI's",
  USER_ROLE_MANAGEMENT: "Gestión de usuarios y roles",
  MANAGE_CAMPAIGNS: "Gestionar campañas",
  ACTIVE_CAMPAIGNS: "Campañas activas",
  TECHNICAL_SUPPORT: "Soporte técnico",
};

/** Who may CREATE which role (hierarchy redesign: Director/Manager user
 * creation). Mirrors usersService.createUser's server-side matrix exactly —
 * this only decides what the dropdown offers; the server is what actually
 * enforces it, so even a tampered request still gets rejected. */
const CREATABLE_ROLES_BY_VIEWER: Record<RoleKey, RoleKey[]> = {
  SUPERUSER: ["SUPERUSER", "DIRECTOR", "CALL_CENTER_LEAD", "CALL_CENTER_AGENT", "MARKETING"],
  DIRECTOR: ["CALL_CENTER_LEAD", "CALL_CENTER_AGENT"],
  CALL_CENTER_LEAD: ["CALL_CENTER_AGENT"],
  CALL_CENTER_AGENT: [],
  MARKETING: [],
};

export function ConfiguracionClient({
  stages,
  canManageStages,
  companies: realCompanies,
  metricoolStatuses,
  whapiStatuses,
  zadarmaStatuses,
  canManageAdmin,
  canAddUsers,
  canManagePermissions,
  viewerRoleKey,
  viewerCompanyId,
  users,
  currentUserId,
}: {
  stages: PipelineStage[];
  canManageStages: boolean;
  companies: Company[];
  /** DB-only provisioning status per company (no Metricool call) — see
   * configuracion/page.tsx. Empty for non-Superuser viewers. */
  metricoolStatuses: CompanyProvisioningStatus[];
  /** Same DB-only pattern as metricoolStatuses, for each company's Whapi
   * (WhatsApp) channel — see whapiOnboardingService.getProvisioningStatusForCompanies. */
  whapiStatuses: WhapiChannelStatus[];
  /** Same DB-only pattern, for each company's Zadarma calling number — see
   * zadarmaNumberOnboardingService.getProvisioningStatusForCompanies. */
  zadarmaStatuses: ZadarmaNumberStatus[];
  canManageAdmin: boolean;
  canAddUsers: boolean;
  /** Superuser (any user) or Director (their own company's Managers/Agents
   * only) — see usersService.assertCanManagePermissionsFor for the real,
   * server-enforced boundary. Gates the Allowed companies/modules panel and
   * "Reset by role". */
  canManagePermissions: boolean;
  viewerRoleKey: RoleKey;
  viewerCompanyId: string | null;
  users: UserRow[];
  currentUserId: string;
}) {
  const isSuperuser = viewerRoleKey === "SUPERUSER";
  const { t, language } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const roleLabels = language === "es" ? ROLE_LABEL_ES : ROLE_LABEL;
  const moduleLabels = language === "es" ? MODULE_LABEL_ES : MODULE_LABEL;
  const [tab, setTab] = useState<"users" | "roles" | "companies" | "pipeline">("users");
  // Deactivated users are hidden from the Users list (see visibleUsers below) —
  // there's no "reactivate" path in this UI (the deactivate button is disabled
  // once !isActive, see the role-badge Card further down), so a hidden user is
  // never reachable here, and the initial selection must skip straight past
  // them to the first user that's actually visible.
  const [selectedId, setSelectedId] = useState(users.find((u) => u.isActive)?.id ?? "");
  const [companyIds, setCompanyIds] = useState<Set<string>>(new Set());
  const [moduleKeys, setModuleKeys] = useState<Set<ModuleKey>>(new Set());
  const [isSuperuserSelected, setIsSuperuserSelected] = useState(false);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [accessError, setAccessError] = useState<string | undefined>();
  const [addCompanyOpen, setAddCompanyOpen] = useState(false);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [pendingRoleKey, setPendingRoleKey] = useState<RoleKey | null>(null);
  const [roleSavePending, setRoleSavePending] = useState(false);
  const [roleError, setRoleError] = useState<string | undefined>();
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [gmailResult, setGmailResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Reads the one-shot ?gmail_connected=<address> / ?gmail_error=<message>
  // query params the OAuth callback route redirects back with (see
  // api/oauth/google/callback/route.ts), shows them as a banner, switches to
  // the Companies tab where the connection actually lives, then strips the
  // params from the URL so a page refresh doesn't keep re-showing the same
  // result.
  useEffect(() => {
    const connected = searchParams.get("gmail_connected");
    const gmailError = searchParams.get("gmail_error");
    if (!connected && !gmailError) return;
    setGmailResult(
      connected
        ? { ok: true, message: t(`Connected ${connected}.`, `${connected} conectado.`) }
        : { ok: false, message: gmailError! }
    );
    setTab("companies");
    router.replace("/configuracion");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read the URL exactly once on mount, not on every searchParams identity change
  }, []);

  // Deactivated accounts stay in the `users` array (the detail panel/role-
  // badge/stat counts below still need to find them by id, e.g. if a stale
  // selectedId somehow pointed at one), but the browsable list itself only
  // ever shows active users — there's no reactivate flow in this UI, so a
  // deactivated account showing here would just be permanent, actionless
  // clutter.
  const visibleUsers = useMemo(() => users.filter((u) => u.isActive), [users]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return visibleUsers;
    return visibleUsers.filter((u) => u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [visibleUsers, userSearch]);

  const roleDescByKey: Record<RoleKey, string> = {
    SUPERUSER: t("Full access to all modules and companies.", "Acceso total a todos los módulos y empresas."),
    DIRECTOR: t("Global view of KPIs and campaigns, without user editing.", "Visión global de KPIs y campañas, sin edición de usuarios."),
    CALL_CENTER_LEAD: t("Manages agents, campaigns and team channels.", "Gestiona agentes, campañas y canales del equipo."),
    CALL_CENTER_AGENT: t("Access to channels and CRM of their assigned clients.", "Acceso a canales y CRM de sus clientes asignados."),
    MARKETING: t("Access to prospecting, campaigns and marketing KPIs.", "Acceso a prospección, campañas y KPIs de marketing."),
  };
  const roles = ROLE_KEYS.map((key) => ({ key, name: roleLabels[key], desc: roleDescByKey[key] }));

  const selected = users.find((u) => u.id === selectedId);

  useEffect(() => {
    // getUserAccessAction is server-gated to Superuser (any target) or
    // Director (their own company's Managers/Agents only) — skip the call
    // entirely for a viewer who can never pass that check rather than
    // firing a request that will just come back empty.
    if (!selectedId || !canManagePermissions) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off a loading flag for the fetch this effect triggers, not a synchronous derived-state mirror
    setLoadingAccess(true);
    setAccessError(undefined);
    getUserAccessAction(selectedId).then((res) => {
      if (!active) return;
      setCompanyIds(new Set(res.companyIds));
      setModuleKeys(new Set(res.modules));
      setIsSuperuserSelected(res.isSuperuser);
      setLoadingAccess(false);
    });
    return () => {
      active = false;
    };
  }, [selectedId, canManagePermissions]);

  // Local role selection only tracks the currently-selected user — reset
  // whenever a different user is picked, not on every `users` prop refresh
  // (a successful save below sets it directly instead, so it stays correct
  // through the revalidation round-trip without this effect needing to see it).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets local role selection to match the newly-picked user, not a reactive cascade
    setPendingRoleKey(null);
    setRoleError(undefined);
    setResetConfirmOpen(false);
  }, [selectedId]);

  const canEditRole = isSuperuser && !!selected && selected.id !== currentUserId;
  const roleDisabledReason = !selected
    ? undefined
    : selected.id === currentUserId
      ? t("You cannot change your own role.", "No puedes cambiar tu propio rol.")
      : t("Only Superusers can change roles.", "Solo los superusuarios pueden cambiar roles.");

  async function handleSaveRole() {
    if (!selected || pendingRoleKey === null || pendingRoleKey === selected.roleKey) return;
    setRoleSavePending(true);
    setRoleError(undefined);
    const result = await updateUserRoleAction(selected.id, pendingRoleKey);
    setRoleSavePending(false);
    if (result.error) {
      setRoleError(result.error);
      return;
    }
    router.refresh();
  }

  function toggle<T>(set: Set<T>, setter: (s: Set<T>) => void, v: T) {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setter(next);
  }

  async function handleSavePermissions() {
    if (!selected) return;
    setSavePending(true);
    setAccessError(undefined);
    const result = await updateUserPermissionsAction({
      userId: selected.id,
      companyIds: Array.from(companyIds),
      modules: Array.from(moduleKeys),
    });
    setSavePending(false);
    if (result.error) setAccessError(result.error);
  }

  /** "Reset by role" — overwrites module access only; company access,
   * assigned contacts, and every other record are untouched (see
   * usersService.resetUserPermissionsToRoleDefault). The confirmation step
   * lives in the modal below; this only runs once the user has confirmed. */
  async function handleResetToRoleDefault() {
    if (!selected) return;
    setResetPending(true);
    setAccessError(undefined);
    const result = await resetUserPermissionsToRoleDefaultAction(selected.id);
    setResetPending(false);
    setResetConfirmOpen(false);
    if (result.error) {
      setAccessError(result.error);
      return;
    }
    if (result.modules) setModuleKeys(new Set(result.modules));
  }

  async function handleDeleteUser() {
    if (!selected) return;
    setDeletePending(true);
    setAccessError(undefined);
    const result = await deactivateUserAction(selected.id);
    setDeletePending(false);
    if (result.error) {
      setAccessError(result.error);
      return;
    }
    const next = users.find((u) => u.id !== selected.id);
    if (next) setSelectedId(next.id);
  }

  return (
    <div className="flex flex-col gap-6">
      {gmailResult && (
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-[13px]",
            gmailResult.ok ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"
          )}
        >
          <span>{gmailResult.message}</span>
          <button type="button" onClick={() => setGmailResult(null)} className="shrink-0 opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      )}
      <PageHeader
        title={t("Settings", "Configuración")}
        subtitle={t("Manage users, roles and access permissions", "Gestiona usuarios, roles y permisos de acceso")}
        actions={
          <>
            <div className="flex rounded-lg bg-text-primary p-1">
              <button
                onClick={() => setTab("users")}
                className={cn(
                  "rounded-md px-4 py-1.5 text-[13.5px] font-medium transition-colors",
                  tab === "users" ? "bg-white text-text-primary" : "text-white/70 hover:text-white"
                )}
              >
                {t("Users", "Usuarios")}
              </button>
              <button
                onClick={() => setTab("roles")}
                className={cn(
                  "rounded-md px-4 py-1.5 text-[13.5px] font-medium transition-colors",
                  tab === "roles" ? "bg-white text-text-primary" : "text-white/70 hover:text-white"
                )}
              >
                {t("Roles", "Roles")}
              </button>
              <button
                onClick={() => setTab("companies")}
                className={cn(
                  "rounded-md px-4 py-1.5 text-[13.5px] font-medium transition-colors",
                  tab === "companies" ? "bg-white text-text-primary" : "text-white/70 hover:text-white"
                )}
              >
                {t("Companies", "Empresas")}
              </button>
              <button
                onClick={() => setTab("pipeline")}
                className={cn(
                  "rounded-md px-4 py-1.5 text-[13.5px] font-medium transition-colors",
                  tab === "pipeline" ? "bg-white text-text-primary" : "text-white/70 hover:text-white"
                )}
              >
                {t("Pipeline", "Pipeline")}
              </button>
            </div>
            {tab === "users" && (
              <>
                <SearchInput
                  placeholder={t("Search user...", "Buscar usuario...")}
                  className="max-w-xs"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                />
                {canAddUsers && (
                  <Button onClick={() => setAddUserOpen(true)}>
                    <Plus className="h-4 w-4" /> {t("Add user", "Agregar usuario")}
                  </Button>
                )}
              </>
            )}
            {tab === "companies" && canManageAdmin && (
              <Button onClick={() => setAddCompanyOpen(true)}>
                <Plus className="h-4 w-4" /> {t("Add company", "Agregar empresa")}
              </Button>
            )}
          </>
        }
      />

      {tab === "users" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
          <Card className="flex flex-col gap-1 p-5">
            <div className="mb-2 flex items-center justify-between">
              <CardTitle>{t("Users", "Usuarios")}</CardTitle>
              <Badge tone="green">
                {users.filter((u) => u.isActive).length} {t("active", "activos")}
              </Badge>
            </div>
            {filteredUsers.map((u) => (
              <button
                key={u.id}
                onClick={() => setSelectedId(u.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors",
                  selectedId === u.id ? "bg-brand-50" : "hover:bg-surface-muted",
                  !u.isActive && "opacity-50"
                )}
              >
                <Avatar name={u.fullName} size={36} />
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-text-primary">{u.fullName}</p>
                  <p className="truncate text-[12px] text-text-secondary">{roleLabels[u.roleKey]}</p>
                </div>
                {u.isOnline !== null && (
                  <span
                    className={cn("ml-auto h-2 w-2 shrink-0 rounded-full", u.isOnline ? "bg-brand" : "bg-text-tertiary")}
                    title={u.isOnline ? t("Online", "En línea") : t("Offline", "Desconectado")}
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}
            {filteredUsers.length === 0 && (
              <p className="px-1 py-2 text-[13px] text-text-secondary">
                {users.length === 0
                  ? t("No users yet.", "Todavía no hay usuarios.")
                  : t("No users match your search.", "Ningún usuario coincide con tu búsqueda.")}
              </p>
            )}
          </Card>

          <div className="flex flex-col gap-6">
            {!selected ? (
              <Card className="p-6">
                <p className="text-[13.5px] text-text-secondary">{t("Select a user.", "Selecciona un usuario.")}</p>
              </Card>
            ) : (
              <>
                <Card className="p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={selected.fullName} size={48} />
                      <div>
                        <p className="text-[17px] font-semibold text-text-primary">{selected.fullName}</p>
                        <p className="text-[13px] text-text-secondary">{selected.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge tone={selected.isActive ? "green" : "gray"}>
                        {selected.isActive ? t("Active user", "Usuario activo") : t("Deactivated", "Desactivado")}
                      </Badge>
                      {/* Agent Online button — self-reported, not a
                       * connection/heartbeat check. Null for every role
                       * except CALL_CENTER_AGENT. */}
                      {selected.isOnline !== null && (
                        <Badge tone={selected.isOnline ? "green" : "gray"}>
                          <span
                            className={cn("mr-1.5 inline-block h-2 w-2 rounded-full", selected.isOnline ? "bg-brand" : "bg-text-tertiary")}
                          />
                          {selected.isOnline ? t("Online", "En línea") : t("Offline", "Desconectado")}
                        </Badge>
                      )}
                      {/* Superuser-only, never on your own account — see
                       * usersService.updateUserRole for the full rationale
                       * (company/module access is intentionally left as-is;
                       * stale manager_agent_assignments rows are cleaned up;
                       * the last active Superuser can't be demoted). */}
                      <div className="w-[180px]">
                        <Select
                          value={pendingRoleKey ?? selected.roleKey}
                          disabled={!canEditRole || roleSavePending}
                          title={canEditRole ? undefined : roleDisabledReason}
                          onChange={(e) => setPendingRoleKey(e.target.value as RoleKey)}
                        >
                          {roles.map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                      {canEditRole && pendingRoleKey !== null && pendingRoleKey !== selected.roleKey && (
                        <Button size="sm" onClick={handleSaveRole} disabled={roleSavePending}>
                          {roleSavePending ? t("Saving...", "Guardando...") : t("Save role", "Guardar rol")}
                        </Button>
                      )}
                    </div>
                  </div>
                  {roleError && <p className="mt-2 text-[13px] text-danger">{roleError}</p>}
                </Card>

                {!canManagePermissions ? null : isSuperuserSelected ? (
                  <Card className="p-6">
                    <p className="text-[13px] text-text-secondary">
                      {t(
                        "Superusers have implicit access to every company and module.",
                        "Los superusuarios tienen acceso implícito a todas las empresas y módulos."
                      )}
                    </p>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <Card className="p-6">
                      <CardTitle>{t("Allowed companies", "Empresas permitidas")}</CardTitle>
                      {/* A Director's own scope is itself company-bound — they
                       * manage module access for their team, never which
                       * companies a user can reach (see
                       * usersService.updateUserPermissions: a Director's
                       * companyIds input is ignored server-side regardless of
                       * what this renders, but disabling it here avoids
                       * implying a toggle that silently wouldn't apply). */}
                      {!isSuperuser && (
                        <p className="mt-1 text-[12px] text-text-tertiary">
                          {t("Only a Superuser can change company access.", "Solo un superusuario puede cambiar el acceso a empresas.")}
                        </p>
                      )}
                      {/* Call Center Agents are restricted to exactly one
                       * company — "One Agent → One Company → One SIP
                       * Extension → Only Assigned Leads" — so this is a
                       * single-select here (clicking a different company
                       * REPLACES the selection, never adds to it), while
                       * every other role keeps the normal multi-select
                       * checkbox list. The real enforcement is server-side
                       * (usersService.updateUserPermissions rejects more
                       * than one company for this role regardless of what
                       * the client sends) — this UI is just the honest
                       * reflection of that rule, not a substitute for it. */}
                      {selected.roleKey === "CALL_CENTER_AGENT" ? (
                        <>
                          <p className="mt-1 text-[12px] text-text-tertiary">
                            {t(
                              "Call Center Agents belong to exactly one company.",
                              "Los agentes de centro de llamadas pertenecen a exactamente una empresa."
                            )}
                          </p>
                          <div className="mt-4 flex flex-col gap-2.5">
                            {realCompanies.map((c) => (
                              <PermissionPill
                                key={c.id}
                                label={c.name}
                                active={companyIds.has(c.id)}
                                disabled={loadingAccess || !isSuperuser}
                                onClick={() => setCompanyIds(new Set([c.id]))}
                              />
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="mt-4 flex flex-col gap-2.5">
                          {realCompanies.map((c) => (
                            <PermissionPill
                              key={c.id}
                              label={c.name}
                              active={companyIds.has(c.id)}
                              disabled={loadingAccess || !isSuperuser}
                              onClick={() => toggle(companyIds, setCompanyIds, c.id)}
                            />
                          ))}
                        </div>
                      )}
                    </Card>
                    <Card className="p-6">
                      <CardTitle>{t("Allowed modules", "Módulos permitidos")}</CardTitle>
                      <div className="mt-4 flex flex-col gap-2.5">
                        {MODULE_KEYS.map((m) => (
                          <PermissionPill
                            key={m}
                            label={moduleLabels[m]}
                            active={moduleKeys.has(m)}
                            disabled={loadingAccess}
                            onClick={() => toggle(moduleKeys, setModuleKeys, m)}
                          />
                        ))}
                      </div>
                    </Card>
                  </div>
                )}

                {!isSuperuserSelected && selected.roleKey === "CALL_CENTER_AGENT" && (
                  <ManagerAssignmentPanel
                    agentId={selected.id}
                    companyIds={isSuperuser ? Array.from(companyIds) : viewerCompanyId ? [viewerCompanyId] : []}
                  />
                )}
                {!isSuperuserSelected && selected.roleKey === "CALL_CENTER_LEAD" && (
                  <ManagerTeamPanel
                    managerId={selected.id}
                    companyIds={isSuperuser ? Array.from(companyIds) : viewerCompanyId ? [viewerCompanyId] : []}
                  />
                )}

                {accessError && <p className="text-[13px] text-danger">{accessError}</p>}

                <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
                  <button
                    onClick={handleDeleteUser}
                    disabled={deletePending || selected.id === currentUserId || !selected.isActive}
                    className="flex items-center gap-1.5 text-[13.5px] font-medium text-danger hover:text-danger-700 disabled:opacity-40"
                    title={
                      selected.id === currentUserId
                        ? t("You cannot delete your own account.", "No puedes eliminar tu propia cuenta.")
                        : undefined
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                    {deletePending ? t("Deleting...", "Eliminando...") : t("Delete user", "Eliminar usuario")}
                  </button>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={() => setResetConfirmOpen(true)}
                      disabled={!canManagePermissions || isSuperuserSelected || loadingAccess}
                      title={
                        !canManagePermissions
                          ? t("Only Superusers and Directors can reset permissions.", "Solo los superusuarios y directores pueden restablecer permisos.")
                          : isSuperuserSelected
                            ? t("Superusers have implicit access and cannot be reset.", "Los superusuarios tienen acceso implícito y no se pueden restablecer.")
                            : undefined
                      }
                    >
                      <RotateCcw className="h-4 w-4" /> {t("Reset by role", "Restablecer por rol")}
                    </Button>
                    <Button onClick={handleSavePermissions} disabled={savePending || loadingAccess || isSuperuserSelected}>
                      {savePending ? t("Saving...", "Guardando...") : t("Save permissions", "Guardar permisos")}
                    </Button>
                  </div>
                </Card>

                {selected && (
                  <Modal
                    open={resetConfirmOpen}
                    onClose={() => (resetPending ? undefined : setResetConfirmOpen(false))}
                    title={t("Reset permissions by role?", "¿Restablecer permisos por rol?")}
                  >
                    <div className="flex flex-col gap-4">
                      <p className="text-[13.5px] leading-6 text-text-secondary">
                        {t(
                          `This replaces ${selected.fullName}'s module access with the approved default for ${roleLabels[selected.roleKey]}. Company access, assigned contacts, and all other data stay exactly as they are.`,
                          `Esto reemplaza el acceso a módulos de ${selected.fullName} con el valor predeterminado aprobado para ${roleLabels[selected.roleKey]}. El acceso a empresas, los contactos asignados y el resto de los datos permanecen exactamente igual.`
                        )}
                      </p>
                      {accessError && <p className="text-[13px] text-danger">{accessError}</p>}
                      <div className="flex justify-end gap-3">
                        <Button variant="outline" onClick={() => setResetConfirmOpen(false)} disabled={resetPending}>
                          {t("Cancel", "Cancelar")}
                        </Button>
                        <Button onClick={handleResetToRoleDefault} disabled={resetPending}>
                          {resetPending ? t("Resetting...", "Restableciendo...") : t("Reset permissions", "Restablecer permisos")}
                        </Button>
                      </div>
                    </div>
                  </Modal>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "roles" && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {roles.map((r) => (
            <Card key={r.key} className="p-5">
              <p className="text-[15px] font-semibold text-text-primary">{r.name}</p>
              <p className="mt-1.5 text-[13px] leading-5 text-text-secondary">{r.desc}</p>
              <p className="mt-3 text-[12.5px] font-medium text-brand-700">
                {users.filter((u) => u.roleKey === r.key && u.isActive).length} {t("users", "usuarios")}
              </p>
            </Card>
          ))}
        </div>
      )}

      {tab === "companies" && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {realCompanies.map((c) => (
            <Card key={c.id} className="flex flex-col gap-4 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[14.5px] font-semibold text-text-primary">{c.name}</p>
                  <p className="truncate text-[12px] text-text-tertiary">{c.slug}</p>
                </div>
              </div>
              {canManageAdmin && (
                <CompanyMetricoolStatus
                  companyId={c.id}
                  companyName={c.name}
                  initialBlogId={metricoolStatuses.find((s) => s.companyId === c.id)?.blogId ?? null}
                />
              )}
              {canManageAdmin && (
                <CompanyWhapiStatus
                  companyId={c.id}
                  initialStatus={whapiStatuses.find((s) => s.companyId === c.id)?.status ?? "NONE"}
                />
              )}
              {canManageAdmin && <CompanyGmailAccounts companyId={c.id} />}
              {canManageAdmin && <CompanyWebmailAccounts companyId={c.id} />}
              {canManageAdmin && (
                <CompanyZadarmaNumber
                  companyId={c.id}
                  companyName={c.name}
                  initialStatus={zadarmaStatuses.find((s) => s.companyId === c.id) ?? { companyId: c.id, status: "NONE", number: null, numberRowId: null }}
                />
              )}
            </Card>
          ))}
          {realCompanies.length === 0 && (
            <p className="text-[13.5px] text-text-secondary">{t("No companies yet.", "Todavía no hay empresas.")}</p>
          )}
          {canManageAdmin && <ZadarmaNumbersPanel companies={realCompanies} />}
          {canManageAdmin && <ZadarmaExtensionsPanel companies={realCompanies} />}
        </div>
      )}

      {tab === "pipeline" && <PipelineStagesPanel stages={stages} canManage={canManageStages} />}

      <AddCompanyModal open={addCompanyOpen} onClose={() => setAddCompanyOpen(false)} />
      <AddUserModal
        open={addUserOpen}
        onClose={() => setAddUserOpen(false)}
        companies={realCompanies}
        viewerRoleKey={viewerRoleKey}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Metricool onboarding — per-company brand provisioning/connection status.
// See src/server/services/metricoolOnboarding.ts for the full write-up of
// why this is three separate calls (DB-only initial status from the page,
// a live on-demand status check, and link generation) rather than one.
// -----------------------------------------------------------------------------

function CompanyMetricoolStatus({
  companyId,
  companyName,
  initialBlogId,
}: {
  companyId: string;
  companyName: string;
  initialBlogId: string | null;
}) {
  const { t } = useLanguage();
  const [blogId, setBlogId] = useState(initialBlogId);
  const [retrying, setRetrying] = useState(false);
  const [checking, setChecking] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [live, setLive] = useState<{ instagramConnected: boolean; facebookConnected: boolean } | undefined>();

  async function handleRetry() {
    setRetrying(true);
    setError(undefined);
    const result = await retryMetricoolProvisioningAction(companyId);
    setRetrying(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.blogId) setBlogId(result.blogId);
  }

  async function handleCheckStatus() {
    setChecking(true);
    setError(undefined);
    const result = await getLiveMetricoolConnectionStatusAction(companyId);
    setChecking(false);
    if ("error" in result && result.error) {
      setError(result.error);
      return;
    }
    if (result.provisioned && "instagramConnected" in result) {
      setLive({ instagramConnected: result.instagramConnected, facebookConnected: result.facebookConnected });
    }
  }

  async function handleConnect() {
    setConnecting(true);
    setError(undefined);
    const result = await generateMetricoolConnectionLinkAction(companyId);
    setConnecting(false);
    if (result.error || !result.link) {
      setError(result.error ?? t("Something went wrong.", "Algo salió mal."));
      return;
    }
    // Opens Metricool's own hosted connection panel — the authorized user
    // completes Instagram/Facebook's real OAuth consent there. This CRM
    // never collects or proxies that consent itself (see
    // integrations/metricool.ts's createConnectionLink doc comment).
    window.open(result.link, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wide text-text-tertiary">METRICOOL</p>
        {blogId && (
          <Badge tone={live ? (live.instagramConnected || live.facebookConnected ? "green" : "amber") : "gray"}>
            {live
              ? live.instagramConnected && live.facebookConnected
                ? t("IG + FB connected", "IG + FB conectados")
                : live.instagramConnected
                  ? t("Instagram connected", "Instagram conectado")
                  : live.facebookConnected
                    ? t("Facebook connected", "Facebook conectado")
                    : t("Not connected yet", "Aún no conectado")
              : t(`Brand #${blogId}`, `Marca #${blogId}`)}
          </Badge>
        )}
      </div>

      {!blogId ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={retrying} onClick={handleRetry}>
            {retrying ? t("Creating...", "Creando...") : t("Create Metricool brand", "Crear marca en Metricool")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
            {t("Link existing brand", "Vincular marca existente")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={connecting} onClick={handleConnect}>
            {connecting
              ? t("Generating link...", "Generando enlace...")
              : t("Connect Instagram/Facebook", "Conectar Instagram/Facebook")}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={checking} onClick={handleCheckStatus}>
            {checking ? t("Checking...", "Comprobando...") : t("Check status", "Comprobar estado")}
          </Button>
        </div>
      )}
      {error && <p className="text-[12px] text-danger">{error}</p>}

      <LinkMetricoolBrandModal
        open={linkOpen}
        companyId={companyId}
        companyName={companyName}
        onClose={() => setLinkOpen(false)}
        onLinked={(linkedBlogId) => {
          setBlogId(linkedBlogId);
          setLinkOpen(false);
        }}
      />
    </div>
  );
}

function LinkMetricoolBrandModal({
  open,
  companyId,
  companyName,
  onClose,
  onLinked,
}: {
  open: boolean;
  companyId: string;
  companyName: string;
  onClose: () => void;
  onLinked: (blogId: string) => void;
}) {
  const { t } = useLanguage();
  const [brands, setBrands] = useState<LinkableBrand[]>([]);
  const [selectedBlogId, setSelectedBlogId] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off a loading flag for the fetch this effect triggers, not a synchronous derived-state mirror
    setLoading(true);
    setError(undefined);
    listLinkableMetricoolBrandsAction().then((r) => {
      if (!active) return;
      setLoading(false);
      if (r.error) setError(r.error);
      setBrands(r.brands);
      setSelectedBlogId(r.brands.find((b) => !b.alreadyLinked)?.blogId ?? "");
    });
    return () => {
      active = false;
    };
  }, [open]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedBlogId) return;
    setPending(true);
    setError(undefined);
    const result = await linkExistingMetricoolBrandAction(companyId, selectedBlogId);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onLinked(selectedBlogId);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t(`Link a Metricool brand to ${companyName}`, `Vincular una marca de Metricool a ${companyName}`)}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {loading ? (
          <p className="text-[13.5px] text-text-tertiary">{t("Loading brands...", "Cargando marcas...")}</p>
        ) : brands.length === 0 ? (
          <p className="text-[13.5px] text-text-tertiary">
            {t("No Metricool brands found on this account.", "No se encontraron marcas de Metricool en esta cuenta.")}
          </p>
        ) : (
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
              {t("METRICOOL BRAND", "MARCA DE METRICOOL")}
            </label>
            <Select value={selectedBlogId} onChange={(e) => setSelectedBlogId(e.target.value)}>
              {brands.map((b) => (
                <option key={b.blogId} value={b.blogId}>
                  {b.label} {b.alreadyLinked ? t("(already linked)", "(ya vinculada)") : ""}
                </option>
              ))}
            </Select>
          </div>
        )}
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("Cancel", "Cancelar")}
          </Button>
          <Button type="submit" disabled={pending || !selectedBlogId}>
            {pending ? t("Linking...", "Vinculando...") : t("Link brand", "Vincular marca")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Whapi (WhatsApp) onboarding — per-company channel provisioning, the
// WhatsApp equivalent of CompanyMetricoolStatus above. On demand only: there
// is no auto-create path, since a Whapi channel is a real, continuously
// billed resource (see server/services/whapiOnboarding.ts's doc comment).
// -----------------------------------------------------------------------------

function CompanyWhapiStatus({ companyId, initialStatus }: { companyId: string; initialStatus: WhapiChannelStatus["status"] }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState(initialStatus);
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [live, setLive] = useState<{ connected: boolean } | undefined>();

  async function handleCreate() {
    setCreating(true);
    setError(undefined);
    const result = await createWhapiChannelAction(companyId);
    setCreating(false);
    if (result.error) {
      setError(result.error);
      // Re-read status from the server rather than guessing — a failure may
      // have landed as FAILED or FAILED_NEEDS_MANUAL_CHECK, both of which
      // change what this card should offer next.
      return;
    }
    setStatus("ACTIVE");
  }

  async function handleRetry() {
    setCreating(true);
    setError(undefined);
    const result = await retryWhapiChannelCreationAction(companyId);
    setCreating(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setStatus("ACTIVE");
  }

  async function handleConfirmNoChannel() {
    setConfirming(true);
    setError(undefined);
    const result = await confirmNoWhapiChannelWasCreatedAction(companyId);
    setConfirming(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setStatus("FAILED");
  }

  async function handleCheckStatus() {
    setChecking(true);
    setError(undefined);
    const result = await getLiveWhapiChannelStatusAction(companyId);
    setChecking(false);
    if ("error" in result && result.error) {
      setError(result.error);
      return;
    }
    if (result.provisioned && "connected" in result) {
      setLive({ connected: result.connected });
    }
  }

  const badgeTone = status === "ACTIVE" ? (live?.connected ? "green" : "amber") : status === "NONE" ? "gray" : "red";
  const badgeLabel =
    status === "ACTIVE"
      ? live
        ? live.connected
          ? t("WhatsApp connected", "WhatsApp conectado")
          : t("Not linked yet", "Aún no vinculado")
        : t("Channel active", "Canal activo")
      : status === "PENDING"
        ? t("Creating...", "Creando...")
        : status === "FAILED_NEEDS_MANUAL_CHECK"
          ? t("Needs manual check", "Requiere verificación manual")
          : status === "FAILED"
            ? t("Failed", "Falló")
            : t("Not created", "No creado");

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wide text-text-tertiary">WHATSAPP (WHAPI)</p>
        <Badge tone={badgeTone}>{badgeLabel}</Badge>
      </div>

      {status === "NONE" && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={creating} onClick={handleCreate}>
            {creating ? t("Creating...", "Creando...") : t("Create WhatsApp channel", "Crear canal de WhatsApp")}
          </Button>
        </div>
      )}

      {status === "FAILED" && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={creating} onClick={handleRetry}>
            {creating ? t("Retrying...", "Reintentando...") : t("Retry", "Reintentar")}
          </Button>
        </div>
      )}

      {status === "FAILED_NEEDS_MANUAL_CHECK" && (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-text-secondary">
            {t(
              "Whapi's response was inconclusive — check the Whapi partner dashboard for a channel matching this company before retrying, to avoid creating a second paid channel.",
              "La respuesta de Whapi fue inconclusa — revisa el panel de socios de Whapi para confirmar si ya existe un canal para esta empresa antes de reintentar, para evitar crear un segundo canal con costo."
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={confirming} onClick={handleConfirmNoChannel}>
              {confirming ? t("Confirming...", "Confirmando...") : t("I checked — no channel exists", "Verifiqué — no existe canal")}
            </Button>
          </div>
        </div>
      )}

      {status === "ACTIVE" && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setQrOpen(true)}>
            {t("Show QR to connect", "Mostrar QR para conectar")}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={checking} onClick={handleCheckStatus}>
            {checking ? t("Checking...", "Comprobando...") : t("Check status", "Comprobar estado")}
          </Button>
        </div>
      )}
      {error && <p className="text-[12px] text-danger">{error}</p>}

      <WhapiQrModal open={qrOpen} companyId={companyId} onClose={() => setQrOpen(false)} />
    </div>
  );
}

/** Renders the QR image returned by getWhapiQrAction — the decrypted
 * channel token itself never reaches this component or the browser at all
 * (see whapiOnboardingService.getQrForCompany); only the already-rendered
 * QR image is ever sent down. The authorized person scans it with the
 * company's actual WhatsApp app (Settings > Linked devices). Polls on an
 * interval while open so the modal can close itself once linked, without
 * requiring a manual "Check status" click mid-scan. */
function WhapiQrModal({ open, companyId, onClose }: { open: boolean; companyId: string; onClose: () => void }) {
  const { t } = useLanguage();
  const [base64, setBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    let active = true;
    async function fetchQr() {
      setLoading(true);
      const result = await getWhapiQrAction(companyId);
      if (!active) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(undefined);
      setBase64(result.base64);
    }
    fetchQr();
    // Whapi's QR expires quickly (per its own docs) — refreshing on an
    // interval while the modal stays open means a slow scanner always sees
    // a live code instead of a stale, expired one.
    const interval = setInterval(fetchQr, 20_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [open, companyId]);

  return (
    <Modal open={open} onClose={onClose} title={t("Scan to connect WhatsApp", "Escanea para conectar WhatsApp")}>
      <div className="flex flex-col items-center gap-4 py-2">
        <p className="text-center text-[13px] text-text-secondary">
          {t(
            "Open WhatsApp on the company's phone → Settings → Linked devices → Link a device, then scan this code.",
            "Abre WhatsApp en el teléfono de la empresa → Configuración → Dispositivos vinculados → Vincular un dispositivo, y escanea este código."
          )}
        </p>
        {loading && !base64 && <p className="text-[13px] text-text-tertiary">{t("Loading QR...", "Cargando QR...")}</p>}
        {error && <p className="text-[13px] text-danger">{error}</p>}
        {base64 && (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived, per-session QR code is not an optimizable static asset
          <img src={base64} alt={t("WhatsApp QR code", "Código QR de WhatsApp")} className="h-56 w-56 rounded-lg border border-border" />
        )}
        <Button type="button" variant="outline" onClick={onClose}>
          {t("Close", "Cerrar")}
        </Button>
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Google Workspace / Gmail onboarding — per-company mailbox connections, the
// email equivalent of CompanyWhapiStatus above. Unlike Whapi (one channel per
// company), a company can connect SEVERAL mailboxes at once (see db/schema.ts's
// company_email_accounts comment) — this renders a list, not a single status.
// -----------------------------------------------------------------------------

const GMAIL_STATUS_TONE: Record<string, "green" | "amber" | "red" | "gray"> = {
  ACTIVE: "green",
  PENDING: "amber",
  NEEDS_REAUTH: "red",
  FAILED: "red",
  DISCONNECTED: "gray",
};

function CompanyGmailAccounts({ companyId }: { companyId: string }) {
  const { t } = useLanguage();
  const [accounts, setAccounts] = useState<GoogleEmailAccountRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  async function refresh() {
    const result = await getGoogleEmailAccountsForCompanyAction(companyId);
    // DISCONNECTED accounts are kept in the database for conversation
    // history (see db/schema.ts), but have nothing actionable left to show
    // here — a disconnected mailbox can always just be reconnected fresh via
    // "Connect Gmail" again, which creates a new row rather than reviving
    // the old one, so the old row would only ever clutter this list.
    setAccounts(result.accounts.filter((a) => a.status !== "DISCONNECTED"));
    setLoaded(true);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once per company card mount, same convention as CompanyWhapiStatus
  }, [companyId]);

  async function handleConnect() {
    setConnecting(true);
    setError(undefined);
    const result = await getGoogleAuthorizationUrlAction(companyId);
    if (result.error || !result.url) {
      setConnecting(false);
      setError(result.error ?? t("Could not start the connection.", "No se pudo iniciar la conexión."));
      return;
    }
    // A full top-level navigation, not a fetch — this is a real OAuth
    // redirect to accounts.google.com, which an in-app request can't
    // represent; the user returns to /configuracion via the server-side
    // callback route's own redirect once consent completes.
    window.location.href = result.url;
  }

  async function handleDisconnect(accountId: string) {
    setDisconnectingId(accountId);
    setError(undefined);
    const result = await disconnectGoogleEmailAccountAction(accountId);
    setDisconnectingId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    await refresh();
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wide text-text-tertiary">GMAIL / GOOGLE WORKSPACE</p>
        <Button type="button" size="sm" variant="outline" disabled={connecting} onClick={handleConnect}>
          <Mail className="h-3.5 w-3.5" />
          {connecting
            ? t("Connecting...", "Conectando...")
            : accounts.length > 0
              ? t("Connect another Gmail account", "Conectar otra cuenta de Gmail")
              : t("Connect Gmail", "Conectar Gmail")}
        </Button>
      </div>

      {loaded && accounts.length === 0 && (
        <p className="text-[12px] text-text-tertiary">{t("No mailboxes connected yet.", "Aún no hay buzones conectados.")}</p>
      )}

      {accounts.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-muted/60 px-2.5 py-1.5">
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-medium text-text-primary">{a.displayName || a.emailAddress}</p>
            {a.displayName && <p className="truncate text-[11px] text-text-tertiary">{a.emailAddress}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge tone={GMAIL_STATUS_TONE[a.status] ?? "gray"}>
              {a.status === "ACTIVE"
                ? t("Connected", "Conectado")
                : a.status === "NEEDS_REAUTH"
                  ? t("Needs reconnect", "Requiere reconexión")
                  : a.status === "PENDING"
                    ? t("Pending", "Pendiente")
                    : a.status}
            </Badge>
            <button
              type="button"
              disabled={disconnectingId === a.id}
              onClick={() => handleDisconnect(a.id)}
              title={t("Disconnect", "Desconectar")}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-danger/10 hover:text-danger disabled:opacity-50"
            >
              <Unlink className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}

      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Universal SMTP/IMAP webmail onboarding — a second, independent connection
// type alongside CompanyGmailAccounts above. Deliberately a separate
// component/modal/action-set (never sharing state or a component with the
// Gmail section) so this feature can never affect how Gmail connects,
// displays, or disconnects. Any webmail provider the company's own IT/host
// gives SMTP+IMAP credentials for — not tied to any specific vendor.
// -----------------------------------------------------------------------------

const WEBMAIL_STATUS_TONE: Record<string, "green" | "amber" | "red" | "gray"> = {
  ACTIVE: "green",
  PENDING: "amber",
  NEEDS_REAUTH: "red",
  FAILED: "red",
  DISCONNECTED: "gray",
};

function CompanyWebmailAccounts({ companyId }: { companyId: string }) {
  const { t } = useLanguage();
  const [accounts, setAccounts] = useState<WebmailAccountRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  async function refresh() {
    const result = await getWebmailAccountsForCompanyAction(companyId);
    // Same reasoning as CompanyGmailAccounts: a DISCONNECTED row is kept
    // for conversation history but has nothing actionable left to show —
    // reconnecting the same address always creates a fresh row.
    setAccounts(result.accounts.filter((a) => a.status !== "DISCONNECTED"));
    setLoaded(true);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once per company card mount, same convention as CompanyGmailAccounts
  }, [companyId]);

  async function handleDisconnect(accountId: string) {
    setDisconnectingId(accountId);
    setError(undefined);
    const result = await disconnectWebmailAccountAction(accountId);
    setDisconnectingId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    await refresh();
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wide text-text-tertiary">{t("WEBMAIL (SMTP/IMAP)", "WEBMAIL (SMTP/IMAP)")}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => setModalOpen(true)}>
          <Mail className="h-3.5 w-3.5" />
          {accounts.length > 0 ? t("Connect another mailbox", "Conectar otro buzón") : t("Connect webmail", "Conectar webmail")}
        </Button>
      </div>

      {loaded && accounts.length === 0 && (
        <p className="text-[12px] text-text-tertiary">{t("No webmail mailboxes connected yet.", "Aún no hay buzones webmail conectados.")}</p>
      )}

      {accounts.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-muted/60 px-2.5 py-1.5">
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-medium text-text-primary">{a.displayName || a.emailAddress}</p>
            {a.displayName && <p className="truncate text-[11px] text-text-tertiary">{a.emailAddress}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge tone={WEBMAIL_STATUS_TONE[a.status] ?? "gray"}>
              {a.status === "ACTIVE"
                ? t("Connected", "Conectado")
                : a.status === "NEEDS_REAUTH"
                  ? t("Needs reconnect", "Requiere reconexión")
                  : a.status === "PENDING"
                    ? t("Pending", "Pendiente")
                    : a.status}
            </Badge>
            <button
              type="button"
              disabled={disconnectingId === a.id}
              onClick={() => handleDisconnect(a.id)}
              title={t("Disconnect", "Desconectar")}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-danger/10 hover:text-danger disabled:opacity-50"
            >
              <Unlink className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}

      {error && <p className="text-[12px] text-danger">{error}</p>}

      <ConnectWebmailModal
        open={modalOpen}
        companyId={companyId}
        onClose={() => setModalOpen(false)}
        onConnected={async () => {
          setModalOpen(false);
          await refresh();
        }}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Zadarma number purchasing — per-company card status + the buy wizard +
// the cross-company "existing numbers" management panel. One shared Zadarma
// account (server-side, unchanged) owns every number; this UI is what lets
// a Superuser buy one through Zadarma's own API and assign it to a company,
// instead of provisioning numbers manually in Zadarma's dashboard. See
// server/services/zadarmaNumberOnboarding.ts for the safe-purchase design
// this wraps (PENDING-first inserts, FAILED vs FAILED_NEEDS_MANUAL_CHECK).
// -----------------------------------------------------------------------------

function CompanyZadarmaNumber({ companyId, companyName, initialStatus }: { companyId: string; companyName: string; initialStatus: ZadarmaNumberStatus }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState(initialStatus);
  const [buyOpen, setBuyOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleRetry() {
    if (!status.numberRowId) return;
    setRetrying(true);
    setError(undefined);
    // A retry re-uses whatever the failed attempt's own direction was —
    // the wizard already collected a fresh documents group id/number choice
    // is not re-askable here without re-opening the wizard, so retry only
    // covers the simplest case (same destination, let Zadarma pick a number
    // again); anything more specific, just buy again via the wizard instead.
    const result = await retryZadarmaPurchaseAction(status.numberRowId, {
      documentsGroupId: "",
      monthlyFee: null,
      connectFee: null,
      currency: null,
    });
    setRetrying(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setStatus((prev) => ({ ...prev, status: "ACTIVE", number: result.number ?? prev.number }));
  }

  async function handleConfirmNoCharge() {
    if (!status.numberRowId) return;
    setConfirming(true);
    setError(undefined);
    const result = await confirmNoZadarmaChargeOccurredAction(status.numberRowId);
    setConfirming(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setStatus((prev) => ({ ...prev, status: "FAILED" }));
  }

  const badgeTone = status.status === "ACTIVE" ? "green" : status.status === "NONE" ? "gray" : status.status === "PENDING" ? "amber" : "red";
  const badgeLabel =
    status.status === "ACTIVE"
      ? status.number ?? t("Active", "Activo")
      : status.status === "PENDING"
        ? t("Purchasing...", "Comprando...")
        : status.status === "FAILED_NEEDS_MANUAL_CHECK"
          ? t("Needs manual check", "Requiere verificación manual")
          : status.status === "FAILED"
            ? t("Purchase failed", "Compra fallida")
            : t("No number", "Sin número");

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wide text-text-tertiary">{t("ZADARMA CALLING", "LLAMADAS (ZADARMA)")}</p>
        <Badge tone={badgeTone}>{badgeLabel}</Badge>
      </div>

      {status.status === "NONE" && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setBuyOpen(true)}>
            {t("Buy Zadarma number", "Comprar número Zadarma")}
          </Button>
        </div>
      )}

      {status.status === "FAILED" && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={retrying} onClick={handleRetry}>
            {retrying ? t("Retrying...", "Reintentando...") : t("Retry", "Reintentar")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setBuyOpen(true)}>
            {t("Buy a different number", "Comprar otro número")}
          </Button>
        </div>
      )}

      {status.status === "FAILED_NEEDS_MANUAL_CHECK" && (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-text-secondary">
            {t(
              "Zadarma's response was inconclusive — check the Zadarma dashboard for an unexpected charge before retrying, to avoid purchasing a second number.",
              "La respuesta de Zadarma fue inconclusa — revisa el panel de Zadarma por un cargo inesperado antes de reintentar, para evitar comprar un segundo número."
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={confirming} onClick={handleConfirmNoCharge}>
              {confirming ? t("Confirming...", "Confirmando...") : t("I checked — no charge occurred", "Verifiqué — no hubo cargo")}
            </Button>
          </div>
        </div>
      )}

      {status.status === "ACTIVE" && (
        <p className="text-[12px] text-text-secondary">
          {t("Reassign or release this number from the Zadarma Numbers panel below.", "Reasigna o libera este número desde el panel de Números Zadarma más abajo.")}
        </p>
      )}

      {error && <p className="text-[12px] text-danger">{error}</p>}

      <BuyZadarmaNumberModal
        open={buyOpen}
        companyId={companyId}
        companyName={companyName}
        onClose={() => setBuyOpen(false)}
        onPurchased={(number, numberRowId) => {
          setBuyOpen(false);
          setStatus({ companyId, status: "ACTIVE", number, numberRowId });
        }}
      />
    </div>
  );
}

type BuyStep = "destination" | "number" | "documents" | "confirm";

/** The actual purchase wizard — country → destination (pricing shown here) →
 * number → documents → an explicit confirm screen before the one paid call.
 * Every step is read-only/free except the final submit (requirement:
 * "require explicit confirmation before submitting a paid order"). */
/** The four distinguishable failure modes the wizard's data-fetch steps can
 * hit (see zadarma.ts's error classes + zadarmaNumberOnboarding.ts's
 * classifyError) — not_configured/unauthorized are account-level problems a
 * retry can never fix, so those two never show a Retry button; the other
 * three (auth/rate_limit/network) are all transient-or-fixable, so they do. */
function zadarmaErrorIcon(reason: ZadarmaErrorReason | undefined) {
  return reason === "not_configured" || reason === "unauthorized" ? "🔒" : reason === "rate_limit" ? "⏳" : reason === "network" ? "📡" : "⚠️";
}

function canRetryZadarmaError(reason: ZadarmaErrorReason | undefined): boolean {
  return reason !== "not_configured" && reason !== "unauthorized";
}

/** Inline error banner used at every fetch step — shows a reason-specific
 * icon and, only when the failure is actually retryable (see
 * canRetryZadarmaError above), a Retry button that re-runs whatever fetch
 * just failed. `onRetry` is the exact same handler the step already calls
 * on its own trigger (country change, destination pick, ...), never a
 * separate code path, so "Retry" can never behave differently from a fresh
 * attempt. */
function ZadarmaFetchError({
  message,
  reason,
  onRetry,
}: {
  message: string;
  reason: ZadarmaErrorReason | undefined;
  onRetry?: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex items-start gap-2 rounded-lg bg-danger-50 px-3 py-2.5">
      <span aria-hidden>{zadarmaErrorIcon(reason)}</span>
      <div className="flex flex-1 flex-col gap-1.5">
        <p className="text-[12.5px] text-danger">{message}</p>
        {onRetry && canRetryZadarmaError(reason) && (
          <Button type="button" size="sm" variant="outline" onClick={onRetry} className="w-fit">
            {t("Retry", "Reintentar")}
          </Button>
        )}
      </div>
    </div>
  );
}

function BuyZadarmaNumberModal({
  open,
  companyId,
  companyName,
  onClose,
  onPurchased,
}: {
  open: boolean;
  companyId: string;
  companyName: string;
  onClose: () => void;
  onPurchased: (number: string, numberRowId: string) => void;
}) {
  const { t } = useLanguage();
  const [step, setStep] = useState<BuyStep>("destination");

  const [countries, setCountries] = useState<ZadarmaCountry[]>([]);
  const [loadingCountries, setLoadingCountries] = useState(false);
  const [countryCode, setCountryCode] = useState("");

  const [destinations, setDestinations] = useState<ZadarmaDestination[]>([]);
  const [loadingDestinations, setLoadingDestinations] = useState(false);
  const [destination, setDestination] = useState<ZadarmaDestination | null>(null);
  // Client-side only — Zadarma's own API has no server-side city/state
  // search parameter (confirmed against its published docs), so filtering
  // an already-fetched destination list is the only option, not a gap in
  // how this calls the API.
  const [destinationFilter, setDestinationFilter] = useState("");
  // Which state groups are expanded — only meaningful when grouping is
  // active (see groupedDestinations below); multiple can be open at once.
  const [expandedStates, setExpandedStates] = useState<Set<string>>(new Set());

  const [numbers, setNumbers] = useState<ZadarmaAvailableNumber[]>([]);
  const [loadingNumbers, setLoadingNumbers] = useState(false);
  const [numberMask, setNumberMask] = useState("");
  const [selectedNumber, setSelectedNumber] = useState<ZadarmaAvailableNumber | null>(null);

  const [groups, setGroups] = useState<ZadarmaDocumentGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newGroupFields, setNewGroupFields] = useState({ first_name: "", last_name: "", email: "", organization: "", country: "", city: "", address: "", phone: "" });
  const [creatingGroup, setCreatingGroup] = useState(false);

  const [balanceMessage, setBalanceMessage] = useState<{ ok: boolean; text: string } | undefined>();
  const [agreed, setAgreed] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [errorReason, setErrorReason] = useState<ZadarmaErrorReason | undefined>();
  // The exact fetch that just failed, so a single generic Retry button can
  // re-run whichever step's request actually broke — never a separate,
  // possibly-diverging "retry" code path from the original attempt.
  const [retryFn, setRetryFn] = useState<(() => void) | null>(null);

  function resetAll() {
    setStep("destination");
    setCountryCode("");
    setDestinations([]);
    setDestination(null);
    setDestinationFilter("");
    setExpandedStates(new Set());
    setNumbers([]);
    setNumberMask("");
    setSelectedNumber(null);
    setGroups([]);
    setSelectedGroupId("");
    setNewGroupFields({ first_name: "", last_name: "", email: "", organization: "", country: "", city: "", address: "", phone: "" });
    setBalanceMessage(undefined);
    setAgreed(false);
    setError(undefined);
    setErrorReason(undefined);
    setRetryFn(null);
  }

  function handleClose() {
    resetAll();
    onClose();
  }

  const loadCountries = useCallback(async () => {
    setLoadingCountries(true);
    setError(undefined);
    setErrorReason(undefined);
    const r = await getZadarmaCountriesAction();
    setLoadingCountries(false);
    setCountries(r.countries);
    if (r.error) {
      setError(r.error);
      setErrorReason(r.reason);
      setRetryFn(() => loadCountries);
    } else {
      setRetryFn(null);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    loadCountries();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once per modal open
  }, [open]);

  const loadDestinations = useCallback(async (code: string) => {
    setLoadingDestinations(true);
    setError(undefined);
    setErrorReason(undefined);
    const r = await getZadarmaDestinationsAction(code);
    setLoadingDestinations(false);
    if (r.error) {
      setError(r.error);
      setErrorReason(r.reason);
      setRetryFn(() => () => loadDestinations(code));
      return;
    }
    setRetryFn(null);
    setDestinations(r.destinations);
  }, []);

  function handleCountryChange(code: string) {
    setCountryCode(code);
    setDestination(null);
    setDestinations([]);
    setDestinationFilter("");
    setExpandedStates(new Set());
    if (!code) return;
    loadDestinations(code);
  }

  const loadNumbers = useCallback(async (directionId: number, mask?: string) => {
    setLoadingNumbers(true);
    setError(undefined);
    setErrorReason(undefined);
    const r = await getZadarmaAvailableNumbersAction(String(directionId), mask || undefined);
    setLoadingNumbers(false);
    if (r.error) {
      setError(r.error);
      setErrorReason(r.reason);
      setRetryFn(() => () => loadNumbers(directionId, mask));
      return;
    }
    setRetryFn(null);
    setNumbers(r.numbers);
  }, []);

  function handlePickDestination(d: ZadarmaDestination) {
    setDestination(d);
    setSelectedNumber(null);
    setNumbers([]);
    setNumberMask("");
    setStep("number");
    loadNumbers(d.id);
  }

  function handleSearchNumbers() {
    if (!destination) return;
    loadNumbers(destination.id, numberMask);
  }

  const loadDocumentGroups = useCallback(async () => {
    setLoadingGroups(true);
    setError(undefined);
    setErrorReason(undefined);
    const r = await getZadarmaDocumentGroupsAction();
    setLoadingGroups(false);
    if (r.error) {
      setError(r.error);
      setErrorReason(r.reason);
      setRetryFn(() => loadDocumentGroups);
      return;
    }
    setRetryFn(null);
    setGroups(r.groups);
  }, []);

  function handleGoToDocuments() {
    setStep("documents");
    loadDocumentGroups();
  }

  async function handleCreateGroup() {
    setCreatingGroup(true);
    setError(undefined);
    const result = await createZadarmaDocumentGroupAction(newGroupFields);
    setCreatingGroup(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.groupId) setSelectedGroupId(result.groupId);
  }

  async function handleGoToConfirm() {
    setStep("confirm");
    if (!destination) return;
    const check = await checkZadarmaBalanceAction({ connect_fee: String(destination.connect_fee), monthly_fee: String(destination.monthly_fee), currency: destination.currency });
    if (check.ok) {
      setBalanceMessage({ ok: true, text: t(`Balance: ${check.balance} ${check.currency} — sufficient.`, `Saldo: ${check.balance} ${check.currency} — suficiente.`) });
    } else {
      setBalanceMessage({ ok: false, text: check.message });
    }
  }

  async function handlePurchase() {
    if (!destination || !agreed) return;
    setPurchasing(true);
    setError(undefined);
    const result = await purchaseZadarmaNumberAction({
      companyId,
      countryCode,
      directionId: String(destination.id),
      documentsGroupId: selectedGroupId,
      numberId: selectedNumber ? String(selectedNumber.id) : undefined,
      monthlyFee: String(destination.monthly_fee),
      connectFee: String(destination.connect_fee),
      currency: destination.currency,
    });
    setPurchasing(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.number) {
      // numberRowId isn't returned by the action (only the activated
      // number itself) — the parent just needs to know a purchase
      // succeeded; it re-derives numberRowId from the next status refresh
      // if needed. Passing the number string is enough to update the badge
      // immediately without waiting on a page reload.
      onPurchased(result.number, "");
    }
  }

  // Filtered (by city/state name) view of the raw fetch — applied BEFORE
  // grouping so a search narrows both the flat list and the grouped one
  // identically, and so a state's displayed city count always reflects
  // what's actually visible, never the unfiltered total.
  const filteredDestinations = useMemo(() => {
    const q = destinationFilter.trim().toLowerCase();
    if (!q) return destinations;
    return destinations.filter((d) => d.name.toLowerCase().includes(q) || (d.stateCode ?? "").toLowerCase().includes(q));
  }, [destinations, destinationFilter]);

  // null means "this country has no reliable state/region data at all" —
  // confirmed live per-country (US: ~99% of destinations carry stateCode;
  // UK/Pakistan: none do), so grouping is only ever offered when the data
  // genuinely supports it, never invented for a country that doesn't have
  // it. A small minority of destinations missing stateCode even within a
  // country that mostly has it fall into a "(unspecified)" catch-all group
  // rather than being silently dropped.
  const groupedDestinations = useMemo(() => {
    const anyHaveState = destinations.some((d) => d.stateCode);
    if (!anyHaveState) return null;
    const byState = new Map<string, ZadarmaDestination[]>();
    for (const d of filteredDestinations) {
      const key = d.stateCode || "—";
      const list = byState.get(key) ?? [];
      list.push(d);
      byState.set(key, list);
    }
    return [...byState.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [destinations, filteredDestinations]);

  function toggleState(stateCode: string) {
    setExpandedStates((prev) => {
      const next = new Set(prev);
      if (next.has(stateCode)) next.delete(stateCode);
      else next.add(stateCode);
      return next;
    });
  }

  function renderDestinationButton(d: ZadarmaDestination) {
    return (
      <button
        key={d.id}
        type="button"
        onClick={() => handlePickDestination(d)}
        className="flex w-full flex-col gap-0.5 rounded-xl border border-border p-3 text-left hover:bg-surface-muted"
      >
        <p className="text-[13.5px] font-medium text-text-primary">
          {d.name} {d.areaCode ? `(${d.areaCode})` : ""}
        </p>
        <p className="text-[12px] text-text-secondary">
          {t("Setup:", "Instalación:")} {d.connect_fee} {d.currency} · {t("Monthly:", "Mensual:")} {d.monthly_fee} {d.currency}
          {d.receive_sms === "true" ? ` · ${t("SMS capable", "Compatible con SMS")}` : ""}
        </p>
        {d.restrictions && (d.restrictions.upload || d.restrictions.specify) && (
          <p className="text-[11.5px] text-warning-700">
            {t("Identity documents required for this destination.", "Se requieren documentos de identidad para este destino.")}
          </p>
        )}
      </button>
    );
  }

  return (
    <Modal open={open} onClose={purchasing ? () => undefined : handleClose} title={t(`Buy Zadarma number — ${companyName}`, `Comprar número Zadarma — ${companyName}`)}>
      <div className="flex flex-col gap-4">
        {step === "destination" && (
          <>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("COUNTRY", "PAÍS")}</label>
              <Select value={countryCode} onChange={(e) => handleCountryChange(e.target.value)} disabled={loadingCountries}>
                <option value="">{loadingCountries ? t("Loading...", "Cargando...") : t("Select a country...", "Selecciona un país...")}</option>
                {countries.map((c) => (
                  <option key={c.countryCodeIso} value={c.countryCodeIso}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>

            {error && step === "destination" && !countryCode && (
              <ZadarmaFetchError message={error} reason={errorReason} onRetry={retryFn ?? undefined} />
            )}

            {loadingDestinations && <p className="text-[12.5px] text-text-tertiary">{t("Loading destinations...", "Cargando destinos...")}</p>}

            {error && countryCode && !loadingDestinations && destinations.length === 0 && (
              <ZadarmaFetchError message={error} reason={errorReason} onRetry={retryFn ?? undefined} />
            )}

            {destinations.length > 0 && (
              <>
                <Input
                  placeholder={t("Filter by state or city...", "Filtrar por estado o ciudad...")}
                  value={destinationFilter}
                  onChange={(e) => setDestinationFilter(e.target.value)}
                />

                {groupedDestinations ? (
                  <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                    {groupedDestinations.map(([stateCode, cities]) => (
                      <div key={stateCode} className="rounded-xl border border-border">
                        <button
                          type="button"
                          onClick={() => toggleState(stateCode)}
                          className="flex w-full items-center justify-between px-3 py-2.5 text-left"
                        >
                          <span className="text-[13px] font-semibold text-text-primary">
                            {stateCode === "—" ? t("Other", "Otro") : stateCode}
                          </span>
                          <span className="flex items-center gap-2 text-[12px] text-text-tertiary">
                            {cities.length} {t("cities", "ciudades")}
                            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expandedStates.has(stateCode) && "rotate-180")} />
                          </span>
                        </button>
                        {expandedStates.has(stateCode) && (
                          <div className="flex flex-col gap-2 border-t border-border p-2">{cities.map(renderDestinationButton)}</div>
                        )}
                      </div>
                    ))}
                    {groupedDestinations.length === 0 && (
                      <p className="py-4 text-center text-[12.5px] text-text-tertiary">{t("No destinations match your filter.", "Ningún destino coincide con tu filtro.")}</p>
                    )}
                  </div>
                ) : (
                  <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                    {filteredDestinations.map(renderDestinationButton)}
                    {filteredDestinations.length === 0 && (
                      <p className="py-4 text-center text-[12.5px] text-text-tertiary">{t("No destinations match your filter.", "Ningún destino coincide con tu filtro.")}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {step === "number" && destination && (
          <>
            <p className="text-[12.5px] text-text-secondary">
              {destination.name} — {t("Setup:", "Instalación:")} {destination.connect_fee} {destination.currency} · {t("Monthly:", "Mensual:")} {destination.monthly_fee} {destination.currency}
            </p>
            <div className="flex gap-2">
              <Input placeholder={t("Filter by digits (optional)", "Filtrar por dígitos (opcional)")} value={numberMask} onChange={(e) => setNumberMask(e.target.value)} />
              <Button type="button" variant="outline" onClick={handleSearchNumbers} disabled={loadingNumbers}>
                {t("Search", "Buscar")}
              </Button>
            </div>
            {loadingNumbers && <p className="text-[12.5px] text-text-tertiary">{t("Loading numbers...", "Cargando números...")}</p>}
            {error && !loadingNumbers && <ZadarmaFetchError message={error} reason={errorReason} onRetry={retryFn ?? undefined} />}
            {!loadingNumbers && !error && numbers.length === 0 && (
              <div className="flex flex-col items-start gap-2">
                <p className="text-[12.5px] text-text-tertiary">{t("No numbers currently available for this destination.", "No hay números disponibles actualmente para este destino.")}</p>
                <Button type="button" size="sm" variant="outline" onClick={() => setStep("destination")}>
                  {t("Choose a different destination", "Elegir otro destino")}
                </Button>
              </div>
            )}
            <div className="flex max-h-60 flex-col gap-2 overflow-y-auto">
              {numbers.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelectedNumber(n)}
                  className={cn(
                    "rounded-xl border p-3 text-left text-[13.5px]",
                    selectedNumber?.id === n.id ? "border-brand bg-brand-50 text-brand" : "border-border text-text-primary hover:bg-surface-muted"
                  )}
                >
                  {n.number}
                </button>
              ))}
            </div>
            <div className="flex justify-between gap-3">
              <Button type="button" variant="outline" onClick={() => setStep("destination")}>
                {t("Back", "Atrás")}
              </Button>
              <Button type="button" disabled={!selectedNumber} onClick={handleGoToDocuments}>
                {t("Next", "Siguiente")}
              </Button>
            </div>
          </>
        )}

        {step === "documents" && (
          <>
            <p className="text-[12.5px] text-text-secondary">
              {t(
                "Most destinations require identity documents to activate a number. Pick an existing document group or create a new one.",
                "La mayoría de los destinos requieren documentos de identidad para activar un número. Elige un grupo de documentos existente o crea uno nuevo."
              )}
            </p>
            {loadingGroups && <p className="text-[12.5px] text-text-tertiary">{t("Loading document groups...", "Cargando grupos de documentos...")}</p>}
            {groups.length > 0 && (
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("EXISTING GROUP", "GRUPO EXISTENTE")}</label>
                <Select value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}>
                  <option value="">{t("None selected", "Ninguno seleccionado")}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {[g.first_name, g.last_name, g.organization].filter(Boolean).join(" ") || g.id}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <p className="text-[11px] font-semibold tracking-wide text-text-secondary">{t("OR CREATE A NEW GROUP", "O CREAR UN GRUPO NUEVO")}</p>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder={t("First name", "Nombre")} value={newGroupFields.first_name} onChange={(e) => setNewGroupFields((p) => ({ ...p, first_name: e.target.value }))} />
              <Input placeholder={t("Last name", "Apellido")} value={newGroupFields.last_name} onChange={(e) => setNewGroupFields((p) => ({ ...p, last_name: e.target.value }))} />
              <Input placeholder={t("Email", "Correo")} value={newGroupFields.email} onChange={(e) => setNewGroupFields((p) => ({ ...p, email: e.target.value }))} />
              <Input placeholder={t("Organization (optional)", "Organización (opcional)")} value={newGroupFields.organization} onChange={(e) => setNewGroupFields((p) => ({ ...p, organization: e.target.value }))} />
              <Input placeholder={t("Country", "País")} value={newGroupFields.country} onChange={(e) => setNewGroupFields((p) => ({ ...p, country: e.target.value }))} />
              <Input placeholder={t("City", "Ciudad")} value={newGroupFields.city} onChange={(e) => setNewGroupFields((p) => ({ ...p, city: e.target.value }))} />
              <Input placeholder={t("Address", "Dirección")} value={newGroupFields.address} onChange={(e) => setNewGroupFields((p) => ({ ...p, address: e.target.value }))} />
              <Input placeholder={t("Phone", "Teléfono")} value={newGroupFields.phone} onChange={(e) => setNewGroupFields((p) => ({ ...p, phone: e.target.value }))} />
            </div>
            <Button type="button" variant="outline" size="sm" disabled={creatingGroup} onClick={handleCreateGroup} className="w-fit">
              {creatingGroup ? t("Creating group...", "Creando grupo...") : t("Create document group", "Crear grupo de documentos")}
            </Button>

            <div className="flex justify-between gap-3">
              <Button type="button" variant="outline" onClick={() => setStep("number")}>
                {t("Back", "Atrás")}
              </Button>
              <Button type="button" disabled={!selectedGroupId} onClick={handleGoToConfirm}>
                {t("Next", "Siguiente")}
              </Button>
            </div>
          </>
        )}

        {step === "confirm" && destination && (
          <>
            <div className="rounded-xl border border-border p-4">
              <p className="text-[14px] font-semibold text-text-primary">{companyName}</p>
              <p className="mt-2 text-[13px] text-text-secondary">{t("Number:", "Número:")} {selectedNumber?.number ?? t("(assigned automatically)", "(asignado automáticamente)")}</p>
              <p className="text-[13px] text-text-secondary">{t("Destination:", "Destino:")} {destination.name}</p>
              <p className="text-[13px] text-text-secondary">{t("Setup fee:", "Costo de instalación:")} {destination.connect_fee} {destination.currency}</p>
              <p className="text-[13px] text-text-secondary">{t("Recurring monthly fee:", "Cargo mensual recurrente:")} {destination.monthly_fee} {destination.currency}</p>
              <p className="text-[13px] text-text-secondary">{t("Renewal:", "Renovación:")} {t("Automatic unless cancelled — same terms as any other Zadarma number.", "Automática a menos que se cancele — mismos términos que cualquier otro número de Zadarma.")}</p>
            </div>

            {balanceMessage && (
              <p className={cn("text-[12.5px]", balanceMessage.ok ? "text-text-secondary" : "text-danger")}>{balanceMessage.text}</p>
            )}

            <label className="flex items-start gap-2 text-[12.5px] text-text-secondary">
              <input type="checkbox" className="mt-0.5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              {t(
                `I understand this will charge the Zadarma account's balance and assign this number to ${companyName}.`,
                `Entiendo que esto generará un cargo al saldo de la cuenta de Zadarma y asignará este número a ${companyName}.`
              )}
            </label>

            {error && <p className="text-[13px] text-danger">{error}</p>}

            <div className="flex justify-between gap-3">
              <Button type="button" variant="outline" disabled={purchasing} onClick={() => setStep("documents")}>
                {t("Back", "Atrás")}
              </Button>
              <Button type="button" disabled={!agreed || purchasing} onClick={handlePurchase}>
                {purchasing ? t("Purchasing...", "Comprando...") : t("Confirm purchase", "Confirmar compra")}
              </Button>
            </div>
          </>
        )}

        {error && step !== "confirm" && <p className="text-[13px] text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

/** Cross-company view of every number this CRM has ever purchased
 * (requirement #8: view existing numbers, assign/reassign safely).
 * Reassignment is a pure DB update — no Zadarma API call — but moving a
 * number away from a company immediately removes that company's calling
 * capability, so it's deliberately gated behind an explicit confirmation
 * dialog rather than firing the instant the dropdown changes — same
 * "optional, Superuser-controlled, with proper warnings" requirement as a
 * role-reset or permission change elsewhere on this page. The dropdown
 * itself only stages the intended change; nothing is sent to the server
 * until the Superuser confirms in the dialog below. */
function ZadarmaNumbersPanel({ companies }: { companies: Company[] }) {
  const { t } = useLanguage();
  const [numbers, setNumbers] = useState<ZadarmaNumberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // The staged, not-yet-confirmed reassignment — null means no dialog open.
  // Keeping the full "from" context here (not just the target id) is what
  // lets the confirmation copy name both companies explicitly, rather than
  // a generic "are you sure?" that doesn't say what's actually changing.
  const [pendingReassign, setPendingReassign] = useState<{ numberRowId: string; number: string | null; fromCompanyId: string | null; toCompanyId: string | null } | null>(null);

  const [addExistingOpen, setAddExistingOpen] = useState(false);
  const [existingNumberInput, setExistingNumberInput] = useState("");
  const [existingNumberCompanyId, setExistingNumberCompanyId] = useState("");
  const [linkingExisting, setLinkingExisting] = useState(false);
  const [linkExistingError, setLinkExistingError] = useState<string | undefined>();

  async function refreshNumbers() {
    setLoading(true);
    const r = await getZadarmaNumbersListAction();
    setLoading(false);
    setNumbers(r.numbers);
  }

  useEffect(() => {
    refreshNumbers();
  }, []);

  function companyName(id: string | null): string {
    if (!id) return t("Unassigned", "Sin asignar");
    return companies.find((c) => c.id === id)?.name ?? t("Unknown company", "Empresa desconocida");
  }

  async function handleConfirmReassign() {
    if (!pendingReassign) return;
    setReassigning(true);
    setError(undefined);
    const result = await reassignZadarmaNumberAction(pendingReassign.numberRowId, pendingReassign.toCompanyId);
    setReassigning(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNumbers((prev) => prev.map((n) => (n.id === pendingReassign.numberRowId ? { ...n, companyId: pendingReassign.toCompanyId } : n)));
    setPendingReassign(null);
  }

  /** Feature 2 — "Add Existing Number." Verifies ownership against the
   * real, connected Zadarma account (read-only) before linking; never
   * purchases anything, never touches Zadarma's own number configuration. */
  async function handleLinkExisting() {
    setLinkingExisting(true);
    setLinkExistingError(undefined);
    const result = await linkExistingZadarmaNumberAction(existingNumberInput.trim(), existingNumberCompanyId);
    setLinkingExisting(false);
    if (!result.ok) {
      setLinkExistingError(result.message);
      return;
    }
    setAddExistingOpen(false);
    setExistingNumberInput("");
    setExistingNumberCompanyId("");
    await refreshNumbers();
  }

  if (loading) return null;

  return (
    <Card className="col-span-full flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <CardTitle>{t("Zadarma Numbers", "Números de Zadarma")}</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setAddExistingOpen(true)}>
          {t("Add Existing Number", "Agregar número existente")}
        </Button>
      </div>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      {numbers.length === 0 && <p className="text-[13.5px] text-text-secondary">{t("No Zadarma numbers yet.", "Todavía no hay números de Zadarma.")}</p>}
      <div className="flex flex-col gap-2">
        {numbers.map((n) => (
          <div key={n.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-text-primary">{n.number ?? t("(not yet activated)", "(aún no activado)")}</p>
              <p className="text-[12px] text-text-secondary">
                {n.status} {n.monthlyFee ? `· ${n.monthlyFee} ${n.currency ?? ""}/mo` : ""} {n.lastError ? `· ${n.lastError}` : ""}
              </p>
            </div>
            {n.status === "ACTIVE" && (
              <Select
                className="w-56"
                value={n.companyId ?? ""}
                disabled={reassigning}
                onChange={(e) =>
                  setPendingReassign({ numberRowId: n.id, number: n.number, fromCompanyId: n.companyId, toCompanyId: e.target.value || null })
                }
              >
                <option value="">{t("Unassigned", "Sin asignar")}</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        ))}
      </div>

      <Modal
        open={!!pendingReassign}
        onClose={() => (reassigning ? undefined : setPendingReassign(null))}
        title={t("Reassign Zadarma number?", "¿Reasignar número de Zadarma?")}
      >
        {pendingReassign && (
          <div className="flex flex-col gap-4">
            <p className="text-[13.5px] leading-6 text-text-secondary">
              {t(
                `This moves ${pendingReassign.number ?? "this number"} from ${companyName(pendingReassign.fromCompanyId)} to ${companyName(pendingReassign.toCompanyId)}.`,
                `Esto mueve ${pendingReassign.number ?? "este número"} de ${companyName(pendingReassign.fromCompanyId)} a ${companyName(pendingReassign.toCompanyId)}.`
              )}
            </p>
            <p className="rounded-lg bg-warning-50 px-3 py-2 text-[12.5px] text-warning-700">
              {t(
                `${companyName(pendingReassign.fromCompanyId)} will immediately lose the ability to make calls from this number — it will have no assigned number until a new one is purchased or reassigned to it.`,
                `${companyName(pendingReassign.fromCompanyId)} perderá inmediatamente la capacidad de llamar desde este número — no tendrá número asignado hasta que se compre uno nuevo o se le reasigne otro.`
              )}
            </p>
            {error && <p className="text-[13px] text-danger">{error}</p>}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setPendingReassign(null)} disabled={reassigning}>
                {t("Cancel", "Cancelar")}
              </Button>
              <Button onClick={handleConfirmReassign} disabled={reassigning}>
                {reassigning ? t("Reassigning...", "Reasignando...") : t("Confirm reassignment", "Confirmar reasignación")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={addExistingOpen}
        onClose={() => (linkingExisting ? undefined : setAddExistingOpen(false))}
        title={t("Add Existing Number", "Agregar número existente")}
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13.5px] leading-6 text-text-secondary">
            {t(
              "For a number already purchased in this central Zadarma account, outside this CRM. It's verified against the real account before being linked — nothing is purchased.",
              "Para un número ya comprado en esta cuenta central de Zadarma, fuera de este CRM. Se verifica contra la cuenta real antes de vincularse — no se compra nada."
            )}
          </p>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("PHONE NUMBER", "NÚMERO DE TELÉFONO")}</label>
            <Input
              placeholder={t("Exactly as shown in Zadarma, e.g. +15551234567", "Exactamente como aparece en Zadarma, ej. +15551234567")}
              value={existingNumberInput}
              onChange={(e) => setExistingNumberInput(e.target.value)}
              disabled={linkingExisting}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("ASSIGN TO COMPANY", "ASIGNAR A EMPRESA")}</label>
            <Select value={existingNumberCompanyId} onChange={(e) => setExistingNumberCompanyId(e.target.value)} disabled={linkingExisting}>
              <option value="">{t("Select a company...", "Selecciona una empresa...")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          {linkExistingError && <p className="text-[13px] text-danger">{linkExistingError}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setAddExistingOpen(false)} disabled={linkingExisting}>
              {t("Cancel", "Cancelar")}
            </Button>
            <Button onClick={handleLinkExisting} disabled={linkingExisting || !existingNumberInput.trim() || !existingNumberCompanyId}>
              {linkingExisting ? t("Verifying...", "Verificando...") : t("Verify and link", "Verificar y vincular")}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

const EXTENSION_STATUS_LABEL: Record<string, { en: string; es: string }> = {
  PENDING: { en: "Creating…", es: "Creando…" },
  ACTIVE: { en: "Active", es: "Activa" },
  FAILED: { en: "Failed", es: "Fallida" },
  FAILED_NEEDS_MANUAL_CHECK: { en: "Needs manual check", es: "Requiere revisión manual" },
  REVOKED: { en: "Revoked", es: "Revocada" },
};

/** Superuser-only SIP/PBX extension management — create/assign/reassign/
 * revoke, entirely from Configuración, backed by the REAL Zadarma API
 * (gated server-side by ZADARMA_LIVE_PBX_PROVISIONING — see
 * zadarmaExtensionOnboarding.ts). This panel never simulates a result: a
 * "provisioning_disabled" reason is a real, honest outcome of the real code
 * path, surfaced as-is, not a fake success. */
function ZadarmaExtensionsPanel({ companies }: { companies: Company[] }) {
  const { t } = useLanguage();
  const [extensions, setExtensions] = useState<ZadarmaExtensionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [limitCheck, setLimitCheck] = useState<{ liveProvisioningEnabled: boolean; existingExtensionCount: number; existingExtensionNumbers: number[]; error?: string } | null>(null);
  const [agentNameCache, setAgentNameCache] = useState<Record<string, string>>({});

  const [createCompanyId, setCreateCompanyId] = useState("");
  const [createAgentOptions, setCreateAgentOptions] = useState<{ id: string; fullName: string }[]>([]);
  const [createUserId, setCreateUserId] = useState("");
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  const [createNotice, setCreateNotice] = useState<string | undefined>();

  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | undefined>();
  const [pendingRevoke, setPendingRevoke] = useState<ZadarmaExtensionRow | null>(null);
  const [pendingReactivate, setPendingReactivate] = useState<ZadarmaExtensionRow | null>(null);
  const [pendingReassign, setPendingReassign] = useState<ZadarmaExtensionRow | null>(null);
  const [reassignCompanyId, setReassignCompanyId] = useState("");
  const [reassignAgentOptions, setReassignAgentOptions] = useState<{ id: string; fullName: string }[]>([]);
  const [reassignUserId, setReassignUserId] = useState("");

  // "Add Existing SIP" (Feature 1) — deliberately its own state, separate
  // from the "Create new" picker above, so the two flows never cross-talk
  // when both entry points are visible at once.
  const [addExistingOpen, setAddExistingOpen] = useState(false);
  const [existingCompanyId, setExistingCompanyId] = useState("");
  const [existingAgentOptions, setExistingAgentOptions] = useState<{ id: string; fullName: string }[]>([]);
  const [existingUserId, setExistingUserId] = useState("");
  const [loadingExistingAgents, setLoadingExistingAgents] = useState(false);
  const [existingSip, setExistingSip] = useState("");
  const [existingSipPassword, setExistingSipPassword] = useState("");
  const [connectingExisting, setConnectingExisting] = useState(false);
  const [connectExistingError, setConnectExistingError] = useState<string | undefined>();

  function companyName(id: string | null): string {
    if (!id) return t("Unassigned", "Sin asignar");
    return companies.find((c) => c.id === id)?.name ?? t("Unknown company", "Empresa desconocida");
  }

  function cacheAgents(agents: { id: string; fullName: string }[]) {
    setAgentNameCache((prev) => {
      const next = { ...prev };
      for (const a of agents) next[a.id] = a.fullName;
      return next;
    });
  }

  async function refreshExtensions() {
    setLoading(true);
    const r = await getZadarmaExtensionsListAction();
    setLoading(false);
    setExtensions(r.extensions);
    const companyIds = [...new Set(r.extensions.map((e) => e.companyId).filter((id): id is string => !!id))];
    for (const companyId of companyIds) {
      getZadarmaAssignableAgentsAction(companyId).then((res) => cacheAgents(res.agents));
    }
  }

  useEffect(() => {
    refreshExtensions();
    getZadarmaExtensionLimitCheckAction().then(setLimitCheck);
  }, []);

  async function handleCreateCompanyChange(companyId: string) {
    setCreateCompanyId(companyId);
    setCreateUserId("");
    setCreateAgentOptions([]);
    if (!companyId) return;
    setLoadingAgents(true);
    const r = await getZadarmaAssignableAgentsAction(companyId);
    setLoadingAgents(false);
    setCreateAgentOptions(r.agents);
    cacheAgents(r.agents);
  }

  async function handleConfirmCreate() {
    setCreating(true);
    setCreateError(undefined);
    setCreateNotice(undefined);
    const result = await createZadarmaExtensionAction(createCompanyId, createUserId);
    setCreating(false);
    setPendingCreate(false);
    if (!result.ok) {
      if (result.reason === "provisioning_disabled") {
        setCreateNotice(result.message);
      } else {
        setCreateError(result.message);
      }
      await refreshExtensions();
      return;
    }
    setCreateCompanyId("");
    setCreateUserId("");
    setCreateAgentOptions([]);
    await refreshExtensions();
  }

  async function handleExistingCompanyChange(companyId: string) {
    setExistingCompanyId(companyId);
    setExistingUserId("");
    setExistingAgentOptions([]);
    if (!companyId) return;
    setLoadingExistingAgents(true);
    const r = await getZadarmaAssignableAgentsAction(companyId);
    setLoadingExistingAgents(false);
    setExistingAgentOptions(r.agents);
    cacheAgents(r.agents);
  }

  /** Feature 1 — "Add Existing SIP." Verifies the extension exists on the
   * real, connected Zadarma account before linking; never creates, never
   * changes its Caller ID or password on Zadarma's side. A Caller ID
   * mismatch is shown as a warning, never auto-corrected. */
  async function handleConnectExisting() {
    setConnectingExisting(true);
    setConnectExistingError(undefined);
    const result = await connectExistingZadarmaExtensionAction(existingCompanyId, existingUserId, existingSip.trim(), existingSipPassword);
    setConnectingExisting(false);
    if (!result.ok) {
      setConnectExistingError(result.message);
      return;
    }
    setAddExistingOpen(false);
    setExistingCompanyId("");
    setExistingUserId("");
    setExistingAgentOptions([]);
    setExistingSip("");
    setExistingSipPassword("");
    await refreshExtensions();
    if (result.callerIdMismatch) {
      setRowError(
        t(
          `Linked extension ${result.sipExtension}, but its Caller ID (${result.callerIdNumber ?? "unknown"}) does NOT match ${companyName(existingCompanyId)}'s assigned number. Browser calling is disabled for it until this is resolved.`,
          `Extensión ${result.sipExtension} vinculada, pero su identificador de llamada (${result.callerIdNumber ?? "desconocido"}) NO coincide con el número asignado a ${companyName(existingCompanyId)}. Las llamadas por navegador están deshabilitadas para ella hasta que se resuelva esto.`
        )
      );
    }
  }

  async function handleRetry(row: ZadarmaExtensionRow) {
    setBusyRowId(row.id);
    setRowError(undefined);
    const result = await retryZadarmaExtensionAction(row.id);
    setBusyRowId(null);
    if (!result.ok && result.reason !== "provisioning_disabled") setRowError(result.message);
    await refreshExtensions();
  }

  async function handleConfirmNoCharge(row: ZadarmaExtensionRow) {
    setBusyRowId(row.id);
    setRowError(undefined);
    const result = await confirmNoZadarmaExtensionChargeAction(row.id);
    setBusyRowId(null);
    if (result.error) setRowError(result.error);
    await refreshExtensions();
  }

  async function handleConfirmRevoke() {
    if (!pendingRevoke) return;
    setBusyRowId(pendingRevoke.id);
    setRowError(undefined);
    const result = await revokeZadarmaExtensionAction(pendingRevoke.id);
    setBusyRowId(null);
    setPendingRevoke(null);
    if (result.error) setRowError(result.error);
    await refreshExtensions();
  }

  function openReassign(row: ZadarmaExtensionRow) {
    setPendingReassign(row);
    setReassignCompanyId(row.companyId ?? "");
    setReassignUserId(row.userId ?? "");
    setReassignAgentOptions(row.companyId && agentNameCache ? [] : []);
    if (row.companyId) {
      getZadarmaAssignableAgentsAction(row.companyId).then((r) => {
        setReassignAgentOptions(r.agents);
        cacheAgents(r.agents);
      });
    }
  }

  async function handleReassignCompanyChange(companyId: string) {
    setReassignCompanyId(companyId);
    setReassignUserId("");
    setReassignAgentOptions([]);
    if (!companyId) return;
    const r = await getZadarmaAssignableAgentsAction(companyId);
    setReassignAgentOptions(r.agents);
    cacheAgents(r.agents);
  }

  /** Restores a REVOKED row to ACTIVE in place — see
   * zadarmaExtensionOnboarding.ts's reactivateExtension doc comment for the
   * full guarantee (same row reused, no Zadarma write calls, Caller ID
   * re-verified as a hard gate). Kept open on failure (never dismissed) so
   * the Superuser sees the specific reason — mismatch/ambiguous Caller ID/
   * not found on account/already has an extension — rather than a toast
   * that might be missed. */
  function closeReactivateModal() {
    setPendingReactivate(null);
    setRowError(undefined);
  }

  async function handleConfirmReactivate() {
    if (!pendingReactivate) return;
    setBusyRowId(pendingReactivate.id);
    setRowError(undefined);
    const result = await reactivateZadarmaExtensionAction(pendingReactivate.id);
    setBusyRowId(null);
    if (result.error) {
      setRowError(result.error);
      return;
    }
    setPendingReactivate(null);
    await refreshExtensions();
  }

  async function handleConfirmReassign() {
    if (!pendingReassign) return;
    setBusyRowId(pendingReassign.id);
    setRowError(undefined);
    const result = await reassignZadarmaExtensionAction(pendingReassign.id, reassignCompanyId, reassignUserId);
    setBusyRowId(null);
    if (result.error) {
      setRowError(result.error);
      return;
    }
    setPendingReassign(null);
    await refreshExtensions();
  }

  if (loading) return null;

  return (
    <Card className="col-span-full flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <CardTitle>{t("Zadarma SIP Extensions", "Extensiones SIP de Zadarma")}</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setAddExistingOpen(true)}>
          {t("Add Existing SIP", "Agregar SIP existente")}
        </Button>
      </div>

      {limitCheck && (
        <div className="rounded-lg bg-surface-muted px-3 py-2.5 text-[12.5px] text-text-secondary">
          {limitCheck.error ? (
            <span className="text-danger">{limitCheck.error}</span>
          ) : (
            <>
              {t(
                `This Zadarma account currently has ${limitCheck.existingExtensionCount} extension(s): ${limitCheck.existingExtensionNumbers.join(", ") || "—"}.`,
                `Esta cuenta de Zadarma tiene actualmente ${limitCheck.existingExtensionCount} extensión(es): ${limitCheck.existingExtensionNumbers.join(", ") || "—"}.`
              )}{" "}
              {limitCheck.existingExtensionCount >= 5 &&
                t(
                  "Zadarma's common free-tier allowance is 5 — creating another extension may incur a recurring charge (confirm on Zadarma's dashboard/plan).",
                  "La asignación gratuita habitual de Zadarma es de 5 — crear otra extensión puede generar un cargo recurrente (confírmalo en el panel/plan de Zadarma)."
                )}
              <br />
              {limitCheck.liveProvisioningEnabled
                ? t("Live provisioning is ENABLED — creating an extension here will make a real, billable Zadarma API call.", "El aprovisionamiento en vivo está HABILITADO — crear una extensión aquí hará una llamada real y facturable a la API de Zadarma.")
                : t("Live provisioning is currently DISABLED — creation attempts will be safely refused before reaching Zadarma.", "El aprovisionamiento en vivo está actualmente DESHABILITADO — los intentos de creación serán rechazados de forma segura antes de llegar a Zadarma.")}
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("COMPANY", "EMPRESA")}</label>
          <Select className="w-56" value={createCompanyId} onChange={(e) => handleCreateCompanyChange(e.target.value)}>
            <option value="">{t("Select a company...", "Selecciona una empresa...")}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("AGENT", "AGENTE")}</label>
          <Select className="w-56" value={createUserId} onChange={(e) => setCreateUserId(e.target.value)} disabled={!createCompanyId || loadingAgents}>
            <option value="">{loadingAgents ? t("Loading...", "Cargando...") : t("Select an agent...", "Selecciona un agente...")}</option>
            {createAgentOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fullName}
              </option>
            ))}
          </Select>
        </div>
        <Button disabled={!createCompanyId || !createUserId} onClick={() => setPendingCreate(true)}>
          {t("Create extension", "Crear extensión")}
        </Button>
      </div>
      {createError && <p className="text-[12.5px] text-danger">{createError}</p>}
      {createNotice && <p className="rounded-lg bg-warning-50 px-3 py-2 text-[12.5px] text-warning-700">{createNotice}</p>}

      <div className="flex flex-col gap-2">
        {extensions.map((ext) => {
          const label = EXTENSION_STATUS_LABEL[ext.status];
          return (
            <div key={ext.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-text-primary">
                  {ext.sipExtension ?? t("(not yet created)", "(aún no creada)")} — {companyName(ext.companyId)} — {ext.userId ? agentNameCache[ext.userId] ?? ext.userId : t("Unassigned", "Sin asignar")}
                </p>
                <p className="text-[12px] text-text-secondary">
                  {label ? t(label.en, label.es) : ext.status}
                  {ext.callerIdNumber ? ` · ${t("Caller ID", "Identificador de llamada")}: ${ext.callerIdNumber}` : ""}
                  {ext.lastError ? ` · ${ext.lastError}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {ext.status === "FAILED" && (
                  <Button size="sm" variant="outline" disabled={busyRowId === ext.id} onClick={() => handleRetry(ext)}>
                    {t("Retry", "Reintentar")}
                  </Button>
                )}
                {ext.status === "FAILED_NEEDS_MANUAL_CHECK" && (
                  <Button size="sm" variant="outline" disabled={busyRowId === ext.id} onClick={() => handleConfirmNoCharge(ext)}>
                    {t("Confirm no charge occurred", "Confirmar que no hubo cargo")}
                  </Button>
                )}
                {ext.status === "ACTIVE" && (
                  <>
                    <Button size="sm" variant="outline" disabled={busyRowId === ext.id} onClick={() => openReassign(ext)}>
                      {t("Reassign", "Reasignar")}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busyRowId === ext.id} onClick={() => setPendingRevoke(ext)}>
                      {t("Revoke", "Revocar")}
                    </Button>
                  </>
                )}
                {ext.status === "REVOKED" && (
                  <Button size="sm" variant="outline" disabled={busyRowId === ext.id} onClick={() => setPendingReactivate(ext)}>
                    {t("Reactivate", "Reactivar")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {extensions.length === 0 && <p className="text-[13.5px] text-text-secondary">{t("No SIP extensions created yet.", "Todavía no se han creado extensiones SIP.")}</p>}
      </div>
      {rowError && <p className="text-[12.5px] text-danger">{rowError}</p>}

      <Modal open={pendingCreate} onClose={() => (creating ? undefined : setPendingCreate(false))} title={t("Create this SIP extension?", "¿Crear esta extensión SIP?")}>
        <div className="flex flex-col gap-4">
          <p className="text-[13.5px] leading-6 text-text-secondary">
            {t(
              `This creates a real Zadarma PBX extension for ${createAgentOptions.find((a) => a.id === createUserId)?.fullName ?? "this agent"} under ${companyName(createCompanyId)}, and sets its Caller ID to this company's own Zadarma number.`,
              `Esto crea una extensión PBX real de Zadarma para ${createAgentOptions.find((a) => a.id === createUserId)?.fullName ?? "este agente"} en ${companyName(createCompanyId)}, y configura su identificador de llamada con el número de Zadarma de esta empresa.`
            )}
          </p>
          {limitCheck && limitCheck.existingExtensionCount >= 5 && (
            <p className="rounded-lg bg-warning-50 px-3 py-2 text-[12.5px] text-warning-700">
              {t(
                "This account is already at or above Zadarma's common free-tier extension allowance — this may incur a recurring monthly charge.",
                "Esta cuenta ya está en o por encima de la asignación gratuita habitual de extensiones de Zadarma — esto puede generar un cargo mensual recurrente."
              )}
            </p>
          )}
          {!limitCheck?.liveProvisioningEnabled && (
            <p className="rounded-lg bg-surface-muted px-3 py-2 text-[12.5px] text-text-secondary">
              {t(
                "Live provisioning is currently disabled, so this attempt will be safely refused before reaching Zadarma — useful to verify the flow end-to-end without any real account change.",
                "El aprovisionamiento en vivo está actualmente deshabilitado, así que este intento será rechazado de forma segura antes de llegar a Zadarma — útil para verificar el flujo sin ningún cambio real en la cuenta."
              )}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setPendingCreate(false)} disabled={creating}>
              {t("Cancel", "Cancelar")}
            </Button>
            <Button onClick={handleConfirmCreate} disabled={creating}>
              {creating ? t("Creating...", "Creando...") : t("Confirm create", "Confirmar creación")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!pendingRevoke} onClose={() => (busyRowId ? undefined : setPendingRevoke(null))} title={t("Revoke this extension?", "¿Revocar esta extensión?")}>
        {pendingRevoke && (
          <div className="flex flex-col gap-4">
            <p className="text-[13.5px] leading-6 text-text-secondary">
              {t(
                `This clears extension ${pendingRevoke.sipExtension}'s Caller ID and marks it revoked — it stops being usable from this CRM. Note: Zadarma's API has no way to delete the extension itself, so it will still exist on the Zadarma account, just unused by GrowthOn.`,
                `Esto elimina el identificador de llamada de la extensión ${pendingRevoke.sipExtension} y la marca como revocada — deja de ser utilizable desde este CRM. Nota: la API de Zadarma no permite eliminar la extensión en sí, por lo que seguirá existiendo en la cuenta de Zadarma, solo sin uso por GrowthOn.`
              )}
            </p>
            {rowError && <p className="text-[13px] text-danger">{rowError}</p>}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setPendingRevoke(null)} disabled={!!busyRowId}>
                {t("Cancel", "Cancelar")}
              </Button>
              <Button onClick={handleConfirmRevoke} disabled={!!busyRowId}>
                {busyRowId ? t("Revoking...", "Revocando...") : t("Confirm revoke", "Confirmar revocación")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!pendingReactivate}
        onClose={() => (busyRowId ? undefined : closeReactivateModal())}
        title={t("Reactivate this extension?", "¿Reactivar esta extensión?")}
      >
        {pendingReactivate && (
          <div className="flex flex-col gap-4">
            <p className="text-[13.5px] leading-6 text-text-secondary">
              {t(
                `This re-links the EXACT same extension ${pendingReactivate.sipExtension} record instead of creating a new one. It only reads from Zadarma to verify the extension still exists there and that its current Caller ID still matches ${companyName(pendingReactivate.companyId)}'s active number — nothing is written to Zadarma, and the stored SIP password is left untouched. If the Caller ID doesn't match (or Zadarma reports an unclear value), reactivation is refused rather than silently enabling browser calling.`,
                `Esto vuelve a vincular el MISMO registro de la extensión ${pendingReactivate.sipExtension} en lugar de crear uno nuevo. Solo lee de Zadarma para verificar que la extensión siga existiendo allí y que su identificador de llamada actual coincida con el número activo de ${companyName(pendingReactivate.companyId)} — no se escribe nada en Zadarma, y la contraseña SIP almacenada no se modifica. Si el identificador de llamada no coincide (o Zadarma reporta un valor poco claro), la reactivación se rechaza en lugar de habilitar silenciosamente las llamadas por navegador.`
              )}
            </p>
            {rowError && <p className="text-[13px] text-danger">{rowError}</p>}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={closeReactivateModal} disabled={!!busyRowId}>
                {t("Cancel", "Cancelar")}
              </Button>
              <Button onClick={handleConfirmReactivate} disabled={!!busyRowId}>
                {busyRowId ? t("Reactivating...", "Reactivando...") : t("Confirm reactivate", "Confirmar reactivación")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!pendingReassign} onClose={() => (busyRowId ? undefined : setPendingReassign(null))} title={t("Reassign this extension?", "¿Reasignar esta extensión?")}>
        {pendingReassign && (
          <div className="flex flex-col gap-4">
            <p className="text-[13.5px] leading-6 text-text-secondary">
              {t(
                `This moves extension ${pendingReassign.sipExtension} to a different company/agent and updates its real Caller ID.`,
                `Esto mueve la extensión ${pendingReassign.sipExtension} a otra empresa/agente y actualiza su identificador de llamada real.`
              )}
            </p>
            <div className="flex flex-wrap gap-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("NEW COMPANY", "NUEVA EMPRESA")}</label>
                <Select className="w-56" value={reassignCompanyId} onChange={(e) => handleReassignCompanyChange(e.target.value)}>
                  <option value="">{t("Select a company...", "Selecciona una empresa...")}</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("NEW AGENT", "NUEVO AGENTE")}</label>
                <Select className="w-56" value={reassignUserId} onChange={(e) => setReassignUserId(e.target.value)} disabled={!reassignCompanyId}>
                  <option value="">{t("Select an agent...", "Selecciona un agente...")}</option>
                  {reassignAgentOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.fullName}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {rowError && <p className="text-[13px] text-danger">{rowError}</p>}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setPendingReassign(null)} disabled={!!busyRowId}>
                {t("Cancel", "Cancelar")}
              </Button>
              <Button onClick={handleConfirmReassign} disabled={!!busyRowId || !reassignCompanyId || !reassignUserId}>
                {busyRowId ? t("Reassigning...", "Reasignando...") : t("Confirm reassignment", "Confirmar reasignación")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={addExistingOpen}
        onClose={() => (connectingExisting ? undefined : setAddExistingOpen(false))}
        title={t("Add Existing SIP Extension", "Agregar extensión SIP existente")}
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13.5px] leading-6 text-text-secondary">
            {t(
              "For an extension already created in Zadarma, outside this CRM. It's verified against the real account before being linked — nothing is created, and its password/Caller ID on Zadarma's side is never changed.",
              "Para una extensión ya creada en Zadarma, fuera de este CRM. Se verifica contra la cuenta real antes de vincularse — no se crea nada, y su contraseña/identificador de llamada en Zadarma nunca se modifica."
            )}
          </p>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("COMPANY", "EMPRESA")}</label>
            <Select className="w-full" value={existingCompanyId} onChange={(e) => handleExistingCompanyChange(e.target.value)} disabled={connectingExisting}>
              <option value="">{t("Select a company...", "Selecciona una empresa...")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("AGENT", "AGENTE")}</label>
            <Select className="w-full" value={existingUserId} onChange={(e) => setExistingUserId(e.target.value)} disabled={!existingCompanyId || loadingExistingAgents || connectingExisting}>
              <option value="">{loadingExistingAgents ? t("Loading...", "Cargando...") : t("Select an agent...", "Selecciona un agente...")}</option>
              {existingAgentOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("SIP EXTENSION / LOGIN", "EXTENSIÓN SIP / LOGIN")}</label>
            <Input
              placeholder={t("e.g. 105", "ej. 105")}
              value={existingSip}
              onChange={(e) => setExistingSip(e.target.value)}
              disabled={connectingExisting}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("SIP PASSWORD", "CONTRASEÑA SIP")}</label>
            <Input
              type="password"
              placeholder={t("As set in Zadarma", "Como está configurada en Zadarma")}
              value={existingSipPassword}
              onChange={(e) => setExistingSipPassword(e.target.value)}
              disabled={connectingExisting}
            />
            <p className="mt-1 text-[11px] text-text-tertiary">
              {t("Encrypted immediately on save — never shown again after this.", "Se cifra inmediatamente al guardar — nunca se vuelve a mostrar después de esto.")}
            </p>
          </div>
          {connectExistingError && <p className="text-[13px] text-danger">{connectExistingError}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setAddExistingOpen(false)} disabled={connectingExisting}>
              {t("Cancel", "Cancelar")}
            </Button>
            <Button
              onClick={handleConnectExisting}
              disabled={connectingExisting || !existingCompanyId || !existingUserId || !existingSip.trim() || !existingSipPassword}
            >
              {connectingExisting ? t("Verifying...", "Verificando...") : t("Verify and link", "Verificar y vincular")}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

const SECURITY_OPTIONS: { value: SmtpImapInput["smtpSecurity"]; label: string }[] = [
  { value: "SSL", label: "SSL/TLS" },
  { value: "STARTTLS", label: "STARTTLS" },
  { value: "NONE", label: "None (not recommended)" },
];

/** Standard, provider-agnostic default ports per security mode — the exact
 * same convention Thunderbird/Outlook/Apple Mail's own manual setup pickers
 * use (IANA-registered: submission/587 for STARTTLS, smtps/465 for
 * implicit TLS, imaps/993, imap/143). These are recommendations only, never
 * enforced — a port typed by hand always wins (see the "only auto-fill an
 * untouched field" logic in RECOMMENDED_PORT_FIELDS' call sites below), since
 * a real minority of providers do use a non-standard port on an otherwise
 * standard security mode. */
const RECOMMENDED_SMTP_PORT: Record<SmtpImapInput["smtpSecurity"], number> = {
  SSL: 465,
  STARTTLS: 587,
  NONE: 25,
};
const RECOMMENDED_IMAP_PORT: Record<SmtpImapInput["smtpSecurity"], number> = {
  SSL: 993,
  STARTTLS: 143,
  NONE: 143,
};

/** The actual connect form — email address, one shared username/password,
 * and host/port/security for SMTP and IMAP separately (most providers use
 * different ports for each, e.g. 465/587 for SMTP vs 993 for IMAP, even
 * when the hostname itself is the same). "Test connection" runs both
 * checks before the form can be submitted at all — connectWebmailAccountAction
 * re-verifies independently server-side regardless (see smtpOnboarding.ts),
 * so this is purely to give the user fast, specific feedback on a typo
 * before they commit. */
function ConnectWebmailModal({
  open,
  companyId,
  onClose,
  onConnected,
}: {
  open: boolean;
  companyId: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const { t } = useLanguage();
  const emptyForm: SmtpImapInput = {
    emailAddress: "",
    displayName: "",
    smtpHost: "",
    smtpPort: 587,
    smtpSecurity: "STARTTLS",
    imapHost: "",
    imapPort: 993,
    imapSecurity: "SSL",
    username: "",
    password: "",
  };
  const [form, setForm] = useState<SmtpImapInput>(emptyForm);
  // Tracks whether the user has EVER manually edited each port field —
  // once true, the recommended-port auto-fill (see handleSecurityChange
  // below) permanently stops touching that field, so a deliberately
  // non-standard port is never silently overwritten just because the
  // security dropdown changes afterward.
  const [smtpPortTouched, setSmtpPortTouched] = useState(false);
  const [imapPortTouched, setImapPortTouched] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | undefined>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function handleClose() {
    setForm(emptyForm);
    setSmtpPortTouched(false);
    setImapPortTouched(false);
    setTestResult(undefined);
    setError(undefined);
    onClose();
  }

  function update<K extends keyof SmtpImapInput>(key: K, value: SmtpImapInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setTestResult(undefined); // any change invalidates a prior successful test
  }

  /** Auto-fills the recommended port for the newly-selected security mode —
   * only when the port hasn't been manually touched yet (a brand-new form,
   * or one where the port was left at its still-untouched initial value).
   * Runs for both SMTP and IMAP security changes via the `which` param,
   * since the two servers' security modes are set independently. */
  function handleSecurityChange(which: "smtp" | "imap", security: SmtpImapInput["smtpSecurity"]) {
    if (which === "smtp") {
      setForm((prev) => ({ ...prev, smtpSecurity: security, smtpPort: smtpPortTouched ? prev.smtpPort : RECOMMENDED_SMTP_PORT[security] }));
    } else {
      setForm((prev) => ({ ...prev, imapSecurity: security, imapPort: imapPortTouched ? prev.imapPort : RECOMMENDED_IMAP_PORT[security] }));
    }
    setTestResult(undefined);
  }

  function handlePortChange(which: "smtp" | "imap", value: number) {
    if (which === "smtp") {
      setSmtpPortTouched(true);
      update("smtpPort", value);
    } else {
      setImapPortTouched(true);
      update("imapPort", value);
    }
  }

  async function handleTest() {
    setTesting(true);
    setError(undefined);
    const result = await testWebmailConnectionAction(form);
    setTesting(false);
    setTestResult(result.ok ? { ok: true } : { ok: false, message: result.error });
  }

  async function handleConnect() {
    setConnecting(true);
    setError(undefined);
    const result = await connectWebmailAccountAction(companyId, form);
    setConnecting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setForm(emptyForm);
    setTestResult(undefined);
    onConnected();
  }

  return (
    <Modal open={open} onClose={handleClose} title={t("Connect webmail", "Conectar webmail")}>
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-text-secondary">
          {t(
            "Works with any email provider that offers SMTP and IMAP access — ask your hosting provider for these settings if you don't already have them. Use an app-specific password if your provider offers one.",
            "Funciona con cualquier proveedor de correo que ofrezca acceso SMTP e IMAP — pide estos datos a tu proveedor de hosting si no los tienes. Usa una contraseña de aplicación si tu proveedor la ofrece."
          )}
        </p>

        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("EMAIL ADDRESS", "DIRECCIÓN DE CORREO")}</label>
          <Input type="email" required value={form.emailAddress} onChange={(e) => update("emailAddress", e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("DISPLAY NAME (OPTIONAL)", "NOMBRE VISIBLE (OPCIONAL)")}</label>
          <Input value={form.displayName ?? ""} onChange={(e) => update("displayName", e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("USERNAME", "NOMBRE DE USUARIO")}</label>
          <Input required value={form.username} onChange={(e) => update("username", e.target.value)} placeholder={t("Usually your email address", "Normalmente tu dirección de correo")} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("PASSWORD", "CONTRASEÑA")}</label>
          <Input type="password" required value={form.password} onChange={(e) => update("password", e.target.value)} />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("SMTP SERVER (OUTGOING)", "SERVIDOR SMTP (SALIENTE)")}</label>
            <Input required value={form.smtpHost} onChange={(e) => update("smtpHost", e.target.value)} placeholder="smtp.example.com" />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("PORT", "PUERTO")}</label>
            <Input type="number" required value={form.smtpPort} onChange={(e) => handlePortChange("smtp", Number(e.target.value))} />
          </div>
        </div>
        <p className="-mt-2 text-[11.5px] text-text-tertiary">
          {t("Port auto-fills based on the security option below — change it anytime.", "El puerto se completa automáticamente según la opción de seguridad de abajo — puedes cambiarlo en cualquier momento.")}
        </p>
        <Select value={form.smtpSecurity} onChange={(e) => handleSecurityChange("smtp", e.target.value as SmtpImapInput["smtpSecurity"])}>
          {SECURITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>

        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("IMAP SERVER (INCOMING)", "SERVIDOR IMAP (ENTRANTE)")}</label>
            <Input required value={form.imapHost} onChange={(e) => update("imapHost", e.target.value)} placeholder="imap.example.com" />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{t("PORT", "PUERTO")}</label>
            <Input type="number" required value={form.imapPort} onChange={(e) => handlePortChange("imap", Number(e.target.value))} />
          </div>
        </div>
        <p className="-mt-2 text-[11.5px] text-text-tertiary">
          {t("Port auto-fills based on the security option below — change it anytime.", "El puerto se completa automáticamente según la opción de seguridad de abajo — puedes cambiarlo en cualquier momento.")}
        </p>
        <Select value={form.imapSecurity} onChange={(e) => handleSecurityChange("imap", e.target.value as SmtpImapInput["smtpSecurity"])}>
          {SECURITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>

        {testResult && (
          <p className={cn("text-[12.5px]", testResult.ok ? "text-success" : "text-danger")}>
            {testResult.ok ? t("Connection successful.", "Conexión exitosa.") : testResult.message}
          </p>
        )}
        {error && <p className="text-[13px] text-danger">{error}</p>}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" disabled={testing} onClick={handleTest}>
            {testing ? t("Testing...", "Probando...") : t("Test connection", "Probar conexión")}
          </Button>
          <Button type="button" disabled={!testResult?.ok || connecting} onClick={handleConnect}>
            {connecting ? t("Connecting...", "Conectando...") : t("Connect", "Conectar")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AddCompanyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  function handleClose() {
    setName("");
    setError(undefined);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    const result = await createCompanyAction(name);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title={t("Add company", "Agregar empresa")}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
            {t("COMPANY NAME", "NOMBRE DE LA EMPRESA")}
          </label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={handleClose}>
            {t("Cancel", "Cancelar")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t("Adding...", "Agregando...") : t("Add company", "Agregar empresa")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AddUserModal({
  open,
  onClose,
  companies,
  viewerRoleKey,
}: {
  open: boolean;
  onClose: () => void;
  companies: Company[];
  viewerRoleKey: RoleKey;
}) {
  const { t, language } = useLanguage();
  const roleLabels = language === "es" ? ROLE_LABEL_ES : ROLE_LABEL;
  const moduleLabels = language === "es" ? MODULE_LABEL_ES : MODULE_LABEL;
  const viewerIsSuperuser = viewerRoleKey === "SUPERUSER";
  const creatableRoles = CREATABLE_ROLES_BY_VIEWER[viewerRoleKey];

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleKey, setRoleKey] = useState<RoleKey>(creatableRoles.includes("CALL_CENTER_AGENT") ? "CALL_CENTER_AGENT" : creatableRoles[0]);
  const [companyIds, setCompanyIds] = useState<Set<string>>(new Set());
  const [moduleKeys, setModuleKeys] = useState<Set<ModuleKey>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  // When there's only one allowed role (Director, Manager), that IS the
  // role being created regardless of leftover dropdown state — no fragile
  // reliance on the initial useState value staying in sync.
  const effectiveRoleKey = creatableRoles.length === 1 ? creatableRoles[0] : roleKey;

  function handleClose() {
    setFullName("");
    setEmail("");
    setPassword("");
    setRoleKey(creatableRoles.includes("CALL_CENTER_AGENT") ? "CALL_CENTER_AGENT" : creatableRoles[0]);
    setCompanyIds(new Set());
    setModuleKeys(new Set());
    setError(undefined);
    onClose();
  }

  function toggleCompany(id: string) {
    setCompanyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleModule(m: ModuleKey) {
    setModuleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    const result = await createUserAction({
      fullName,
      email,
      password,
      roleKey: effectiveRoleKey,
      // Ignored server-side for a Director/Manager creator (always forced to
      // their own company) — only meaningful when viewerIsSuperuser.
      companyIds: Array.from(companyIds),
      modules: Array.from(moduleKeys),
    });
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    handleClose();
  }

  const isSuperuserRole = effectiveRoleKey === "SUPERUSER";

  return (
    <Modal open={open} onClose={handleClose} title={t("Add user", "Agregar usuario")} className="max-w-xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
              {t("FULL NAME", "NOMBRE COMPLETO")}
            </label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
              {t("EMAIL", "CORREO")}
            </label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
              {t("PASSWORD", "CONTRASEÑA")}
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
              {t("ROLE", "ROL")}
            </label>
            {creatableRoles.length <= 1 ? (
              <p className="flex h-10 items-center text-[14px] font-medium text-text-primary">
                {roleLabels[effectiveRoleKey]}
              </p>
            ) : (
              <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value as RoleKey)}>
                {creatableRoles.map((r) => (
                  <option key={r} value={r}>
                    {roleLabels[r]}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </div>

        {isSuperuserRole ? (
          <p className="rounded-lg bg-surface-muted px-3.5 py-2.5 text-[13px] text-text-secondary">
            {t(
              "Superusers implicitly have access to every company and module.",
              "Los superusuarios tienen acceso implícito a todas las empresas y módulos."
            )}
          </p>
        ) : (
          <>
            {!viewerIsSuperuser && (
              <p className="rounded-lg bg-surface-muted px-3.5 py-2.5 text-[13px] text-text-secondary">
                {t(
                  "This user will be added to your own company automatically.",
                  "Este usuario se agregará automáticamente a tu propia empresa."
                )}
              </p>
            )}
            <div className={cn("grid grid-cols-1 gap-4", viewerIsSuperuser && "sm:grid-cols-2")}>
              {viewerIsSuperuser && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-tertiary">
                    {t("COMPANY ACCESS", "ACCESO A EMPRESAS")}
                  </p>
                  <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
                    {companies.map((c) => (
                      <PermissionCheckbox
                        key={c.id}
                        label={c.name}
                        checked={companyIds.has(c.id)}
                        onClick={() => toggleCompany(c.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-tertiary">
                  {t("MODULE ACCESS", "ACCESO A MÓDULOS")}
                </p>
                <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
                  {MODULE_KEYS.map((m) => (
                    <PermissionCheckbox
                      key={m}
                      label={moduleLabels[m]}
                      checked={moduleKeys.has(m)}
                      onClick={() => toggleModule(m)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={handleClose}>
            {t("Cancel", "Cancelar")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t("Adding...", "Agregando...") : t("Add user", "Agregar usuario")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PermissionCheckbox({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors",
        checked ? "bg-brand-50 text-brand-700" : "text-text-secondary hover:bg-surface-muted"
      )}
    >
      <CheckCircle2 className={cn("h-3.5 w-3.5 shrink-0", checked ? "text-brand" : "text-gray-300")} />
      <span className="truncate">{label}</span>
    </button>
  );
}

function PermissionPill({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2.5 rounded-full px-4 py-2.5 text-left text-[13.5px] font-medium transition-colors disabled:opacity-50",
        active
          ? "bg-brand-50 text-brand-700"
          : "bg-surface-muted text-text-tertiary line-through decoration-1"
      )}
    >
      <CheckCircle2 className={cn("h-4 w-4 shrink-0", active ? "text-brand" : "text-gray-300")} />
      {label}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Manager <-> Agent assignment (hierarchy redesign phase 2). Scoped to
// exactly one company at a time — an agent/manager with 0 or 2+ companies
// selected can't use this panel yet (edge case, not the common single-
// company flow the spec describes); the panel asks for exactly one instead
// of guessing which company the relationship applies to.
// -----------------------------------------------------------------------------

function ManagerAssignmentPanel({ agentId, companyIds }: { agentId: string; companyIds: string[] }) {
  const { t } = useLanguage();
  const companyId = companyIds.length === 1 ? companyIds[0] : undefined;
  const [managers, setManagers] = useState<{ id: string; fullName: string }[]>([]);
  const [managerUserId, setManagerUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off a loading flag for the fetch this effect triggers, not a synchronous derived-state mirror
    setLoading(true);
    setSaved(false);
    Promise.all([getManagersForCompanyAction(companyId), getAgentManagerAction(agentId, companyId)]).then(
      ([managersRes, managerRes]) => {
        if (!active) return;
        setManagers(managersRes.users);
        setManagerUserId(managerRes.managerUserId ?? "");
        setLoading(false);
      }
    );
    return () => {
      active = false;
    };
  }, [agentId, companyId]);

  async function handleSave() {
    if (!companyId) return;
    setPending(true);
    setError(undefined);
    setSaved(false);
    const result = await setAgentManagerAction({ agentUserId: agentId, companyId, managerUserId: managerUserId || null });
    setPending(false);
    if (result.error) setError(result.error);
    else setSaved(true);
  }

  return (
    <Card className="p-6">
      <CardTitle>{t("Manager", "Gerente")}</CardTitle>
      {!companyId ? (
        <p className="mt-3 text-[13px] text-text-secondary">
          {t(
            "Assign exactly one company above to set this agent's manager.",
            "Asigna exactamente una empresa arriba para fijar el gerente de este agente."
          )}
        </p>
      ) : (
        <>
          <div className="mt-3 max-w-xs">
            <Select value={managerUserId} onChange={(e) => setManagerUserId(e.target.value)} disabled={loading}>
              <option value="">{t("Unassigned", "Sin asignar")}</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </Select>
          </div>
          {managers.length === 0 && !loading && (
            <p className="mt-2 text-[12.5px] text-text-tertiary">
              {t("No Call Center Managers in this company yet.", "Todavía no hay gerentes de Call Center en esta empresa.")}
            </p>
          )}
          {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={handleSave} disabled={pending || loading}>
              {pending ? t("Saving...", "Guardando...") : t("Save manager", "Guardar gerente")}
            </Button>
            {saved && <span className="text-[12.5px] font-medium text-success">{t("Saved.", "Guardado.")}</span>}
          </div>
        </>
      )}
    </Card>
  );
}

function ManagerTeamPanel({ managerId, companyIds }: { managerId: string; companyIds: string[] }) {
  const { t } = useLanguage();
  const companyId = companyIds.length === 1 ? companyIds[0] : undefined;
  const [team, setTeam] = useState<{ id: string; fullName: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off a loading flag for the fetch this effect triggers, not a synchronous derived-state mirror
    setLoading(true);
    getManagerTeamAction(managerId, companyId).then((res) => {
      if (!active) return;
      setTeam(res.team);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [managerId, companyId]);

  return (
    <Card className="p-6">
      <CardTitle>{t("Team", "Equipo")}</CardTitle>
      {!companyId ? (
        <p className="mt-3 text-[13px] text-text-secondary">
          {t(
            "Assign exactly one company above to see this manager's team.",
            "Asigna exactamente una empresa arriba para ver el equipo de este gerente."
          )}
        </p>
      ) : loading ? (
        <p className="mt-3 text-[13px] text-text-secondary">{t("Loading...", "Cargando...")}</p>
      ) : team.length === 0 ? (
        <p className="mt-3 text-[13px] text-text-secondary">
          {t("No agents assigned to this manager yet.", "Todavía no hay agentes asignados a este gerente.")}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
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

// -----------------------------------------------------------------------------
// Pipeline stages management — real data. Reorder (up/down) and activate/
// deactivate the 7 shared stages. Renaming isn't offered: stage labels are
// translated from a fixed set of keys in src/lib/pipeline.ts, not free text
// stored per-stage, so a text-rename field here couldn't actually take effect
// anywhere else in the app.
// -----------------------------------------------------------------------------

function PipelineStagesPanel({ stages, canManage }: { stages: PipelineStage[]; canManage: boolean }) {
  const { t, language } = useLanguage();
  const stageLabels = language === "es" ? STAGE_LABEL_ES : STAGE_LABEL;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  async function handleMove(id: string, direction: "up" | "down") {
    setBusyId(id);
    setError(undefined);
    const result = await moveStageAction(id, direction);
    setBusyId(null);
    if (result.error) setError(result.error);
  }

  async function handleToggle(id: string) {
    setBusyId(id);
    setError(undefined);
    const result = await toggleStageActiveAction(id);
    setBusyId(null);
    if (result.error) setError(result.error);
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <CardTitle>{t("Sales pipeline stages", "Etapas del pipeline de ventas")}</CardTitle>
        <p className="mt-1 text-[13px] text-text-secondary">
          {t(
            "Shared across every company. Reorder or deactivate a stage without affecting existing contacts already in it.",
            "Compartidas entre todas las empresas. Reordena o desactiva una etapa sin afectar a los contactos que ya están en ella."
          )}
        </p>
      </div>

      {!canManage && (
        <p className="rounded-lg bg-surface-muted px-3.5 py-2.5 text-[13px] text-text-secondary">
          {t("Only Superusers can reorder or deactivate stages. You can view them below.", "Solo los superusuarios pueden reordenar o desactivar etapas. Puedes verlas a continuación.")}
        </p>
      )}
      {error && <p className="text-[13px] text-danger">{error}</p>}

      <div className="flex flex-col gap-2">
        {stages.map((stage, i) => (
          <div
            key={stage.id}
            className={cn(
              "flex items-center gap-3 rounded-xl border p-3.5",
              stage.isActive ? "border-border" : "border-border bg-surface-muted opacity-60"
            )}
          >
            <span className="w-6 shrink-0 text-center text-[12px] font-semibold text-text-tertiary">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold text-text-primary">
                {stageLabels[stage.key as Stage] ?? stage.key}
              </p>
            </div>
            <Badge tone={stage.isActive ? "green" : "gray"}>
              {stage.isActive ? t("Active", "Activa") : t("Inactive", "Inactiva")}
            </Badge>
            {canManage && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => handleMove(stage.id, "up")}
                  disabled={busyId === stage.id || i === 0}
                  aria-label={t("Move up", "Mover arriba")}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-surface-muted hover:text-text-primary disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleMove(stage.id, "down")}
                  disabled={busyId === stage.id || i === stages.length - 1}
                  aria-label={t("Move down", "Mover abajo")}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-surface-muted hover:text-text-primary disabled:opacity-30"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleToggle(stage.id)}
                  disabled={busyId === stage.id}
                  aria-label={stage.isActive ? t("Deactivate", "Desactivar") : t("Activate", "Activar")}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-surface-muted hover:text-text-primary disabled:opacity-30"
                >
                  <Power className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
