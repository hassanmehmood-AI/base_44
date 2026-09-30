"use client";

import { useState } from "react";
import { Plus, CheckCircle2, Trash2, RotateCcw, ArrowUp, ArrowDown, Power } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SearchInput, Select } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { PageHeader } from "@/components/PageHeader";
import { useLanguage } from "@/context/LanguageContext";
import { STAGE_LABEL, STAGE_LABEL_ES, Stage } from "@/lib/pipeline";
import {
  users,
  allowedCompanies,
  allowedModules,
  kpiDepartments,
} from "@/lib/mock-data";
import { cn } from "@/lib/cn";
import type { PipelineStage } from "@/server/repositories/pipelineStages";
import { toggleStageActiveAction, moveStageAction } from "./actions";

export function ConfiguracionClient({ stages, canManageStages }: { stages: PipelineStage[]; canManageStages: boolean }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<"users" | "roles" | "pipeline">("users");
  const [selectedId, setSelectedId] = useState(users[0].id);
  const [companies, setCompanies] = useState(new Set(allowedCompanies));
  const [modules, setModules] = useState(new Set(allowedModules));
  const [departments, setDepartments] = useState(new Set(kpiDepartments));

  const roles = [
    { name: t("Superuser", "Superusuario"), desc: t("Full access to all modules and companies.", "Acceso total a todos los módulos y empresas.") },
    { name: t("Director", "Director"), desc: t("Global view of KPIs and campaigns, without user editing.", "Visión global de KPIs y campañas, sin edición de usuarios.") },
    { name: t("Call Center Lead", "Jefe de Call Center"), desc: t("Manages agents, campaigns and team channels.", "Gestiona agentes, campañas y canales del equipo.") },
    { name: t("Call Center Agent", "Agente Call Center"), desc: t("Access to channels and CRM of their assigned clients.", "Acceso a canales y CRM de sus clientes asignados.") },
    { name: t("Marketing", "Marketing"), desc: t("Access to prospecting, campaigns and marketing KPIs.", "Acceso a prospección, campañas y KPIs de marketing.") },
  ];

  const selected = users.find((u) => u.id === selectedId) ?? users[0];

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, v: string) {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setter(next);
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
                onClick={() => setTab("pipeline")}
                className={cn(
                  "rounded-md px-4 py-1.5 text-[13.5px] font-medium transition-colors",
                  tab === "pipeline" ? "bg-white text-text-primary" : "text-white/70 hover:text-white"
                )}
              >
                {t("Pipeline", "Pipeline")}
              </button>
            </div>
            {tab !== "pipeline" && (
              <>
                <SearchInput placeholder={t("Search user...", "Buscar usuario...")} className="max-w-xs" />
                <Button>
                  <Plus className="h-4 w-4" /> {t("Invite user", "Invitar usuario")}
                </Button>
              </>
            )}
          </>
        }
      />

      {tab === "users" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
          <Card className="flex flex-col gap-1 p-5">
            <div className="mb-2 flex items-center justify-between">
              <CardTitle>{t("Users", "Usuarios")}</CardTitle>
              <Badge tone="green">{users.length} {t("active", "activos")}</Badge>
            </div>
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => setSelectedId(u.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors",
                  selectedId === u.id ? "bg-brand-50" : "hover:bg-surface-muted"
                )}
              >
                <Avatar name={u.name} size={36} />
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-text-primary">{u.name}</p>
                  <p className="truncate text-[12px] text-text-secondary">{u.role}</p>
                </div>
              </button>
            ))}
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={selected.name} size={48} />
                  <div>
                    <p className="text-[17px] font-semibold text-text-primary">{selected.name}</p>
                    <p className="text-[13px] text-text-secondary">{selected.role}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone="green">{t("Active user", "Usuario activo")}</Badge>
                  <div className="w-[180px]">
                    <Select defaultValue={selected.role}>
                      {roles.map((r) => (
                        <option key={r.name}>{r.name}</option>
                      ))}
                    </Select>
                  </div>
                </div>
              </div>
            </Card>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <Card className="p-6">
                <CardTitle>{t("Allowed companies", "Empresas permitidas")}</CardTitle>
                <div className="mt-4 flex flex-col gap-2.5">
                  {allowedCompanies.map((c) => (
                    <PermissionPill
                      key={c}
                      label={c}
                      active={companies.has(c)}
                      onClick={() => toggle(companies, setCompanies, c)}
                    />
                  ))}
                </div>
              </Card>
              <Card className="p-6">
                <CardTitle>{t("Allowed modules", "Módulos permitidos")}</CardTitle>
                <div className="mt-4 flex flex-col gap-2.5">
                  {allowedModules.map((m) => (
                    <PermissionPill
                      key={m}
                      label={m}
                      active={modules.has(m)}
                      onClick={() => toggle(modules, setModules, m)}
                    />
                  ))}
                </div>
              </Card>
            </div>

            <Card className="p-6">
              <CardTitle>{t("Specific KPI permissions", "Permisos específicos de KPI")}</CardTitle>
              <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <p className="mb-2.5 text-[11px] font-semibold tracking-wide text-text-tertiary">
                    {t("DEPARTMENTS", "DEPARTAMENTOS")}
                  </p>
                  <div className="flex flex-col gap-2.5">
                    {kpiDepartments.map((d) => (
                      <PermissionPill
                        key={d}
                        label={d}
                        active={departments.has(d)}
                        onClick={() => toggle(departments, setDepartments, d)}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2.5 text-[11px] font-semibold tracking-wide text-text-tertiary">
                    {t("COMPANIES", "EMPRESAS")}
                  </p>
                  <div className="flex flex-col gap-2.5">
                    {allowedCompanies.map((c) => (
                      <PermissionPill
                        key={c}
                        label={c}
                        active={companies.has(c)}
                        onClick={() => toggle(companies, setCompanies, c)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
              <button className="flex items-center gap-1.5 text-[13.5px] font-medium text-danger hover:text-danger-700">
                <Trash2 className="h-4 w-4" /> {t("Delete user", "Eliminar usuario")}
              </button>
              <div className="flex gap-3">
                <Button variant="outline">
                  <RotateCcw className="h-4 w-4" /> {t("Reset by role", "Restablecer por rol")}
                </Button>
                <Button>{t("Save permissions", "Guardar permisos")}</Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "roles" && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {roles.map((r) => (
            <Card key={r.name} className="p-5">
              <p className="text-[15px] font-semibold text-text-primary">{r.name}</p>
              <p className="mt-1.5 text-[13px] leading-5 text-text-secondary">{r.desc}</p>
              <p className="mt-3 text-[12.5px] font-medium text-brand-700">
                {users.filter((u) => u.role === r.name).length} {t("users", "usuarios")}
              </p>
            </Card>
          ))}
        </div>
      )}

      {tab === "pipeline" && <PipelineStagesPanel stages={stages} canManage={canManageStages} />}
    </div>
  );
}

function PermissionPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 rounded-full px-4 py-2.5 text-left text-[13.5px] font-medium transition-colors",
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
