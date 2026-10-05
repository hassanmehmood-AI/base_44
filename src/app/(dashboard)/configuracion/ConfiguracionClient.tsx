"use client";

import { useEffect, useState } from "react";
import { Plus, CheckCircle2, Trash2, RotateCcw, ArrowUp, ArrowDown, Power, Building2 } from "lucide-react";
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
  deactivateUserAction,
} from "./actions";

export type UserRow = {
  id: string;
  fullName: string;
  email: string;
  roleKey: RoleKey;
  isActive: boolean;
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

export function ConfiguracionClient({
  stages,
  canManageStages,
  companies: realCompanies,
  canManageAdmin,
  users,
  currentUserId,
}: {
  stages: PipelineStage[];
  canManageStages: boolean;
  companies: Company[];
  canManageAdmin: boolean;
  users: UserRow[];
  currentUserId: string;
}) {
  const { t, language } = useLanguage();
  const roleLabels = language === "es" ? ROLE_LABEL_ES : ROLE_LABEL;
  const moduleLabels = language === "es" ? MODULE_LABEL_ES : MODULE_LABEL;
  const [tab, setTab] = useState<"users" | "roles" | "companies" | "pipeline">("users");
  const [selectedId, setSelectedId] = useState(users[0]?.id ?? "");
  const [companyIds, setCompanyIds] = useState<Set<string>>(new Set());
  const [moduleKeys, setModuleKeys] = useState<Set<ModuleKey>>(new Set());
  const [isSuperuserSelected, setIsSuperuserSelected] = useState(false);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [accessError, setAccessError] = useState<string | undefined>();
  const [addCompanyOpen, setAddCompanyOpen] = useState(false);
  const [addUserOpen, setAddUserOpen] = useState(false);

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
    if (!selectedId) return;
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
  }, [selectedId]);

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
                <SearchInput placeholder={t("Search user...", "Buscar usuario...")} className="max-w-xs" />
                {canManageAdmin && (
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
            {users.map((u) => (
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
              </button>
            ))}
            {users.length === 0 && (
              <p className="px-1 py-2 text-[13px] text-text-secondary">{t("No users yet.", "Todavía no hay usuarios.")}</p>
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
                      <div className="w-[180px]">
                        <Select value={selected.roleKey} disabled title={t("Role changes aren't available yet.", "El cambio de rol todavía no está disponible.")}>
                          {roles.map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  </div>
                </Card>

                {isSuperuserSelected ? (
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
                      <div className="mt-4 flex flex-col gap-2.5">
                        {realCompanies.map((c) => (
                          <PermissionPill
                            key={c.id}
                            label={c.name}
                            active={companyIds.has(c.id)}
                            disabled={loadingAccess}
                            onClick={() => toggle(companyIds, setCompanyIds, c.id)}
                          />
                        ))}
                      </div>
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
                    <Button variant="outline" disabled title={t("Coming soon", "Próximamente")}>
                      <RotateCcw className="h-4 w-4" /> {t("Reset by role", "Restablecer por rol")}
                    </Button>
                    <Button onClick={handleSavePermissions} disabled={savePending || loadingAccess || isSuperuserSelected}>
                      {savePending ? t("Saving...", "Guardando...") : t("Save permissions", "Guardar permisos")}
                    </Button>
                  </div>
                </Card>
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
                {users.filter((u) => u.roleKey === r.key).length} {t("users", "usuarios")}
              </p>
            </Card>
          ))}
        </div>
      )}

      {tab === "companies" && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {realCompanies.map((c) => (
            <Card key={c.id} className="flex items-center gap-3 p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <Building2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[14.5px] font-semibold text-text-primary">{c.name}</p>
                <p className="truncate text-[12px] text-text-tertiary">{c.slug}</p>
              </div>
            </Card>
          ))}
          {realCompanies.length === 0 && (
            <p className="text-[13.5px] text-text-secondary">{t("No companies yet.", "Todavía no hay empresas.")}</p>
          )}
        </div>
      )}

      {tab === "pipeline" && <PipelineStagesPanel stages={stages} canManage={canManageStages} />}

      <AddCompanyModal open={addCompanyOpen} onClose={() => setAddCompanyOpen(false)} />
      <AddUserModal open={addUserOpen} onClose={() => setAddUserOpen(false)} companies={realCompanies} />
    </div>
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

function AddUserModal({ open, onClose, companies }: { open: boolean; onClose: () => void; companies: Company[] }) {
  const { t, language } = useLanguage();
  const roleLabels = language === "es" ? ROLE_LABEL_ES : ROLE_LABEL;
  const moduleLabels = language === "es" ? MODULE_LABEL_ES : MODULE_LABEL;

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleKey, setRoleKey] = useState<RoleKey>("CALL_CENTER_AGENT");
  const [companyIds, setCompanyIds] = useState<Set<string>>(new Set());
  const [moduleKeys, setModuleKeys] = useState<Set<ModuleKey>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  function handleClose() {
    setFullName("");
    setEmail("");
    setPassword("");
    setRoleKey("CALL_CENTER_AGENT");
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
      roleKey,
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

  const isSuperuserRole = roleKey === "SUPERUSER";

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
            <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value as RoleKey)}>
              {ROLE_KEYS.map((r) => (
                <option key={r} value={r}>
                  {roleLabels[r]}
                </option>
              ))}
            </Select>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
