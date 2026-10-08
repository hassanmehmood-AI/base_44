"use client";

import { useState } from "react";
import { Phone, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SearchInput, Select, Textarea, Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { PageHeader } from "@/components/PageHeader";
import { StageBadge } from "@/components/StageBadge";
import { useLanguage } from "@/context/LanguageContext";
import { useCompany, ALL_COMPANIES } from "@/context/CompanyContext";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import type { ContactWithJoins } from "@/server/repositories/contacts";
import type { ActivityWithAuthor } from "@/server/repositories/activities";
import type { Call } from "@/server/repositories/calls";
import type { PipelineStage } from "@/server/repositories/pipelineStages";
import { CALL_STATUSES, type CallStatus } from "@/server/constants";
import { getContactCallDetailAction, initiateCallAction, logCallResultAction } from "./actions";

const STATUS_LABEL: Record<CallStatus, string> = {
  COMPLETED: "Completed",
  MISSED: "Missed",
  NO_ANSWER: "No answer",
  FAILED: "Failed",
};
const STATUS_LABEL_ES: Record<CallStatus, string> = {
  COMPLETED: "Completada",
  MISSED: "Perdida",
  NO_ANSWER: "Sin respuesta",
  FAILED: "Fallida",
};

export function LlamadasClient({
  queue,
  stages,
  initialSelectedId,
  initialActivities,
  initialCalls,
}: {
  queue: ContactWithJoins[];
  stages: PipelineStage[];
  initialSelectedId: string | null;
  initialActivities: ActivityWithAuthor[];
  initialCalls: Call[];
}) {
  const { t } = useLanguage();
  const { activeCompany, setActiveCompany } = useCompany();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [activities, setActivities] = useState(initialActivities);
  const [calls, setCalls] = useState(initialCalls);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState("");

  const filteredQueue = queue.filter((c) => activeCompany === ALL_COMPANIES || c.companyName === activeCompany);

  const searchedQueue = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredQueue;
    return filteredQueue.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q)
    );
  })();

  // Looked up from the searched/company-scoped queue (not raw `queue`): a
  // contact selected before switching companies or searching must stop
  // showing once it's filtered out, falling back to the empty state instead
  // of another, unrelated contact's call history.
  const selected = searchedQueue.find((c) => c.id === selectedId);

  async function selectContact(id: string) {
    setSelectedId(id);
    setLoadingDetail(true);
    const result = await getContactCallDetailAction(id);
    setActivities(result.activities);
    setCalls(result.calls);
    setLoadingDetail(false);
  }

  async function refreshDetail() {
    if (!selectedId) return;
    const result = await getContactCallDetailAction(selectedId);
    setActivities(result.activities);
    setCalls(result.calls);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Call Management", "Gestión de Llamadas")}
        subtitle={t("Call queue and results log", "Cola de llamadas y registro de resultados")}
        actions={
          <SearchInput
            placeholder={t("Search client, phone or email...", "Buscar cliente, teléfono o correo...")}
            className="max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-[200px]">
          <Select value={activeCompany} onChange={(e) => setActiveCompany(e.target.value)}>
            <option value={ALL_COMPANIES}>{t("All companies", "Todas las empresas")}</option>
            {[...new Set(queue.map((c) => c.companyName))].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr_320px]">
        <Card className="flex flex-col gap-1 p-5">
          <div className="mb-2 flex items-center justify-between">
            <CardTitle>{t("Clients to call", "Clientes por llamar")}</CardTitle>
            <Badge tone="green">{searchedQueue.length} {t("in queue", "en cola")}</Badge>
          </div>
          <div className="flex max-h-[560px] flex-col gap-1 overflow-y-auto">
            {searchedQueue.map((c) => (
              <button
                key={c.id}
                onClick={() => selectContact(c.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left transition-colors",
                  selectedId === c.id ? "bg-brand-50" : "hover:bg-surface-muted"
                )}
              >
                <Phone className="h-4 w-4 shrink-0 text-brand" />
                <span className="truncate text-[13.5px] font-medium text-text-primary">{c.name}</span>
              </button>
            ))}
            {searchedQueue.length === 0 && (
              <p className="py-6 text-center text-[13px] text-text-tertiary">
                {filteredQueue.length === 0
                  ? t("No contacts with a phone number yet.", "Aún no hay contactos con teléfono.")
                  : t("No contacts match your search.", "Ningún contacto coincide con tu búsqueda.")}
              </p>
            )}
          </div>
        </Card>

        {selected ? (
          <CallPanel
            key={selected.id}
            contact={selected}
            stages={stages}
            activities={activities}
            calls={calls}
            loadingDetail={loadingDetail}
            onSaved={refreshDetail}
          />
        ) : (
          <Card className="flex items-center justify-center p-6 text-[13.5px] text-text-tertiary">
            {t("Select a client to start calling.", "Selecciona un cliente para empezar a llamar.")}
          </Card>
        )}
      </div>
    </div>
  );
}

function CallPanel({
  contact,
  stages,
  activities,
  calls,
  loadingDetail,
  onSaved,
}: {
  contact: ContactWithJoins;
  stages: PipelineStage[];
  activities: ActivityWithAuthor[];
  calls: Call[];
  onSaved: () => void;
  loadingDetail: boolean;
}) {
  const { t, language } = useLanguage();
  const statusLabels = language === "es" ? STATUS_LABEL_ES : STATUS_LABEL;

  const [callPending, setCallPending] = useState(false);
  const [callMessage, setCallMessage] = useState<string | undefined>();

  const [status, setStatus] = useState<CallStatus>("COMPLETED");
  const [duration, setDuration] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [pipelineStageId, setPipelineStageId] = useState(contact.pipelineStageId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  async function handleStartCall() {
    setCallPending(true);
    setCallMessage(undefined);
    const result = await initiateCallAction(contact.id);
    setCallPending(false);
    setCallMessage(result.error ?? t("Call requested.", "Llamada solicitada."));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(undefined);
    setSaved(false);
    const result = await logCallResultAction({
      contactId: contact.id,
      direction: "OUTBOUND",
      phoneNumber: contact.phone ?? "",
      status,
      durationSeconds: duration,
      outcome,
      notes,
      pipelineStageId,
    });
    setSaving(false);
    if (result.error) {
      setSaveError(result.error);
      return;
    }
    setSaved(true);
    setOutcome("");
    setNotes("");
    setDuration("");
    onSaved();
  }

  return (
    <>
      <Card className="flex flex-col items-center gap-6 p-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <Avatar name={contact.name} size={56} />
          <p className="text-[18px] font-semibold text-text-primary">{contact.name}</p>
          <p className="text-[14px] text-text-secondary">{contact.phone}</p>
          <StageBadge stage={contact.stageKey} />
        </div>

        <button
          onClick={handleStartCall}
          disabled={callPending}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-sidebar-active text-white shadow-lg shadow-brand/30 transition-transform hover:scale-105 hover:bg-[color-mix(in_srgb,var(--sidebar-active)_82%,black)] disabled:opacity-60"
        >
          <PhoneCall className="h-6 w-6" />
        </button>
        {callMessage && <p className="text-center text-[12.5px] text-text-secondary">{callMessage}</p>}

        <div className="w-full border-t border-border pt-5">
          <p className="mb-3 text-[15px] font-semibold text-text-primary">{t("Activity history", "Historial de actividad")}</p>
          {loadingDetail ? (
            <p className="text-center text-[13px] text-text-tertiary">{t("Loading...", "Cargando...")}</p>
          ) : activities.length === 0 ? (
            <p className="text-center text-[13px] text-text-tertiary">{t("No activity yet.", "Aún no hay actividad.")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {activities.slice(0, 5).map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-xl border border-border p-3.5">
                  <div>
                    <p className="text-[13.5px] font-semibold text-text-primary">
                      {a.type}
                      {a.outcome ? ` · ${a.outcome}` : ""}
                    </p>
                    <p className="text-[12px] text-text-secondary">{a.authorName}</p>
                  </div>
                  <span className="text-[12px] text-text-tertiary">{formatRelativeTime(a.createdAt, language)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <CardTitle>{t("Call result", "Resultado de llamada")}</CardTitle>

        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
            {t("STATUS", "ESTADO")}
          </label>
          <Select value={status} onChange={(e) => setStatus(e.target.value as CallStatus)}>
            {CALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
            {t("DURATION (SECONDS)", "DURACIÓN (SEGUNDOS)")}
          </label>
          <Input type="number" min="0" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
            {t("COMMERCIAL STATUS", "ESTADO COMERCIAL")}
          </label>
          <Select value={pipelineStageId} onChange={(e) => setPipelineStageId(e.target.value)}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.key}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
            {t("OUTCOME", "RESULTADO")}
          </label>
          <Input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder={t("e.g. Interested", "ej. Interesado")} />
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
            {t("NOTES", "NOTAS")}
          </label>
          <Textarea rows={3} placeholder={t("Call summary...", "Resumen de la llamada...")} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {saveError && <p className="text-[13px] text-danger">{saveError}</p>}
        {saved && <p className="text-[13px] text-success">{t("Call result saved.", "Resultado guardado.")}</p>}

        <Button className="mt-1 w-full" disabled={saving} onClick={handleSave}>
          {saving ? t("Saving...", "Guardando...") : t("Save result", "Guardar resultado")}
        </Button>

        {calls.length > 0 && (
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-secondary">
              {t("RECENT CALLS", "LLAMADAS RECIENTES")}
            </p>
            <div className="flex flex-col gap-2">
              {calls.slice(0, 3).map((c) => (
                <div key={c.id} className="flex items-center justify-between text-[12.5px]">
                  <span className="text-text-secondary">{statusLabels[c.status as CallStatus] ?? c.status}</span>
                  <span className="text-text-tertiary">{formatRelativeTime(c.startedAt, language)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
