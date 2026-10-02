"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Upload,
  Phone,
  Mail,
  MessageCircle,
  Building2,
  Clock,
  ArrowRight,
  Pencil,
  Sparkles,
  Globe,
  CheckSquare,
  CheckCircle2,
  List,
  Kanban,
  Download,
  AlertCircle,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SearchInput, Select, Textarea, Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";
import { StageBadge } from "@/components/StageBadge";
import { useLanguage } from "@/context/LanguageContext";
import { useCompany, ALL_COMPANIES } from "@/context/CompanyContext";
import { STAGE_TONE, STAGE_LABEL, STAGE_LABEL_ES, Stage } from "@/lib/pipeline";
import { formatRelativeTime, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { downloadTextFile } from "@/lib/csv";

import { parseContactImportRows, CONTACTS_IMPORT_TEMPLATE_CSV, MAX_CONTACTS_IMPORT_ROWS, type ContactImportRow } from "@/lib/contactsImport";
import type { ContactWithJoins } from "@/server/repositories/contacts";
import type { PipelineStage } from "@/server/repositories/pipelineStages";
import type { ActivityWithAuthor } from "@/server/repositories/activities";
import type { UserWithRole } from "@/server/repositories/users";
import type { TaskWithAssignee } from "@/server/repositories/tasks";
import {
  createContactAction,
  updateContactAction,
  classifyContactAction,
  addNoteAction,
  moveContactStageAction,
  getContactActivitiesAction,
  getAssignableUsersAction,
  getContactTasksAction,
  createTaskAction,
  completeTaskAction,
  importContactsAction,
} from "./actions";

const toneDot: Record<string, string> = {
  green: "bg-success",
  amber: "bg-warning",
  blue: "bg-info",
  gray: "bg-text-tertiary",
};

const channelIcon: Record<string, React.ElementType> = {
  WHATSAPP: MessageCircle,
  CALL: Phone,
  EMAIL: Mail,
  SOCIAL: Globe,
  NOTE: CheckSquare,
};

// Same fixed option set as the original design (5 of the 7 pipeline stages) —
// intentionally not expanded to keep the classify panel's shape unchanged.
const CLASSIFY_STAGE_KEYS = ["NUEVO_LEAD", "CONTACTADO", "INTERESADO", "OPORTUNIDAD", "CLIENTE"];

const CHANNEL_OPTIONS: { value: string; type: string; channel: string; labelEn: string; labelEs: string }[] = [
  { value: "CALL", type: "CALL", channel: "CALL", labelEn: "Call", labelEs: "Llamada" },
  { value: "WHATSAPP", type: "SOCIAL", channel: "WHATSAPP", labelEn: "WhatsApp", labelEs: "WhatsApp" },
  { value: "EMAIL", type: "EMAIL", channel: "EMAIL", labelEn: "Email", labelEs: "Correo" },
  { value: "SOCIAL", type: "SOCIAL", channel: "SOCIAL", labelEn: "Social media", labelEs: "Redes sociales" },
];

type CompanyOption = { id: string; name: string };

export function CrmClient({
  contacts,
  stages,
  companies,
  initialSelectedId,
  initialActivities,
  initialTasks,
}: {
  contacts: ContactWithJoins[];
  stages: PipelineStage[];
  companies: CompanyOption[];
  initialSelectedId: string | null;
  initialActivities: ActivityWithAuthor[];
  initialTasks: TaskWithAssignee[];
}) {
  const { t, language } = useLanguage();
  const { companies: companyNames, activeCompany, setActiveCompany } = useCompany();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [historyTab, setHistoryTab] = useState("All");
  const [search, setSearch] = useState("");
  const [activities, setActivities] = useState<ActivityWithAuthor[]>(initialActivities);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<UserWithRole[]>([]);
  const [tasks, setTasks] = useState<TaskWithAssignee[]>(initialTasks);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [view, setView] = useState<"list" | "board">("list");
  const [, startTransition] = useTransition();

  const stageLabels = language === "es" ? STAGE_LABEL_ES : STAGE_LABEL;

  const historyTabs = [
    t("All", "Todos"),
    "WhatsApp",
    t("Calls", "Llamadas"),
    t("Email", "Correo"),
    t("Social Media", "Redes Sociales"),
    t("Tasks / Notes", "Tareas / Notas"),
  ];
  const tabToChannel: Record<string, string> = {
    WhatsApp: "WHATSAPP",
    [t("Calls", "Llamadas")]: "CALL",
    [t("Email", "Correo")]: "EMAIL",
    [t("Social Media", "Redes Sociales")]: "SOCIAL",
  };

  const selected = contacts.find((c) => c.id === selectedId) ?? contacts[0];

  const filteredContacts = useMemo(
    () =>
      contacts.filter((c) => {
        const matchesCompany = activeCompany === ALL_COMPANIES || c.companyName === activeCompany;
        const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
        return matchesCompany && matchesSearch;
      }),
    [contacts, activeCompany, search]
  );

  const classifyStages = useMemo(
    () => CLASSIFY_STAGE_KEYS.map((key) => stages.find((s) => s.key === key)).filter((s): s is PipelineStage => !!s),
    [stages]
  );

  const filteredActivities = useMemo(() => {
    const channel = tabToChannel[historyTab];
    if (!channel) return activities;
    return activities.filter((a) => a.channel === channel);
  }, [activities, historyTab]); // eslint-disable-line react-hooks/exhaustive-deps -- tabToChannel is derived fresh each render from stable translations

  useEffect(() => {
    if (!selected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off a loading flag for the fetch this effect triggers, not a synchronous derived-state mirror
    setActivitiesLoading(true);
    getContactActivitiesAction(selected.id)
      .then((r) => setActivities(r.activities))
      .finally(() => setActivitiesLoading(false));
    getAssignableUsersAction(selected.companyId).then((r) => setAssignableUsers(r.users));
    getContactTasksAction(selected.id).then((r) => setTasks(r.tasks));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch when the selected contact actually changes
  }, [selected?.id]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("CRM", "CRM")}
        subtitle={t("View, organize and classify all client contacts", "Visualiza, organiza y clasifica todos los contactos de clientes")}
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput placeholder={t("Search...", "Buscar...")} className="max-w-sm" />
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> {t("New contact", "Nuevo contacto")}
        </Button>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" /> {t("Import Excel/CSV", "Importar Excel/CSV")}
        </Button>

        <div className="ml-auto flex rounded-lg bg-surface-muted p-1">
          <button
            onClick={() => setView("list")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
              view === "list" ? "bg-white text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
            )}
          >
            <List className="h-3.5 w-3.5" /> {t("List", "Lista")}
          </button>
          <button
            onClick={() => setView("board")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
              view === "board" ? "bg-white text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
            )}
          >
            <Kanban className="h-3.5 w-3.5" /> {t("Board", "Tablero")}
          </button>
        </div>
      </div>

      {view === "board" && (
        <PipelineBoard
          stages={stages}
          contacts={filteredContacts}
          onSelect={(id) => {
            setSelectedId(id);
            setView("list");
          }}
          onMoved={() => router.refresh()}
        />
      )}

      <div className={cn("grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)_300px]", view === "board" && "hidden")}>
        {/* Contacts list */}
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <CardTitle>{t("Contacts", "Contactos")}</CardTitle>
            <Badge tone="green">{filteredContacts.length}</Badge>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveCompany(ALL_COMPANIES)}
              className={cn(
                "rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                activeCompany === ALL_COMPANIES
                  ? "bg-text-primary text-white"
                  : "bg-surface-muted text-text-secondary hover:bg-gray-200"
              )}
            >
              {t("All", "Todos")}
            </button>
            {companyNames.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCompany(c)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  activeCompany === c
                    ? "bg-text-primary text-white"
                    : "bg-surface-muted text-text-secondary hover:bg-gray-200"
                )}
              >
                {c}
              </button>
            ))}
          </div>

          <div>
            <SearchInput
              placeholder={t("Search client, phone", "Buscar cliente, teléfono")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5 -mx-1">
            {filteredContacts.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                  selectedId === c.id || (!selectedId && selected?.id === c.id) ? "bg-brand-50" : "hover:bg-surface-muted"
                )}
              >
                <Avatar name={c.name} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-text-primary">{c.name}</p>
                  <p className="truncate text-[12px] text-text-secondary">{c.companyName}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", toneDot[STAGE_TONE[c.stageKey as Stage] ?? "gray"])}
                    aria-hidden
                  />
                  <span className="text-[11px] text-text-tertiary" suppressHydrationWarning>
                    {formatRelativeTime(c.lastContactAt, language)}
                  </span>
                </div>
              </button>
            ))}
            {filteredContacts.length === 0 && (
              <p className="px-3 py-6 text-center text-[13px] text-text-tertiary">
                {contacts.length === 0
                  ? t("No contacts yet. Create the first one.", "Aún no hay contactos. Crea el primero.")
                  : t("No contacts for this filter.", "No hay contactos para este filtro.")}
              </p>
            )}
          </div>
        </Card>

        {/* Contact detail */}
        {!selected ? (
          <Card className="flex items-center justify-center p-6 text-center text-[13.5px] text-text-tertiary">
            {t("Select or create a contact to see details.", "Selecciona o crea un contacto para ver los detalles.")}
          </Card>
        ) : (
          <Card className="flex flex-col gap-6 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-4">
                <Avatar name={selected.name} size={52} />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-[19px] font-semibold text-text-primary">{selected.name}</h2>
                    <StageBadge stage={selected.stageKey} />
                  </div>
                  <p className="mt-1 text-[13.5px] text-text-secondary">{selected.businessName || selected.companyName}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setTaskOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> {t("New Task", "Nueva Tarea")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil className="h-3.5 w-3.5" /> {t("Edit contact", "Editar contacto")}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <InfoField icon={Phone} label={t("PHONE", "TELÉFONO")} value={selected.phone || "—"} />
              <InfoField icon={Mail} label={t("EMAIL", "EMAIL")} value={selected.email || "—"} />
              <InfoField
                icon={MessageCircle}
                label={t("AGENT", "AGENTE")}
                value={selected.assignedUserName || t("Unassigned", "Sin asignar")}
              />
              <InfoField icon={Building2} label={t("SOURCE", "ORIGEN")} value={selected.leadSource || "—"} />
              <InfoField
                icon={Clock}
                label={t("LAST CONTACT", "ÚLTIMO CONTACTO")}
                value={formatDateTime(selected.lastContactAt, language)}
              />
              <InfoField icon={ArrowRight} label={t("NEXT ACTION", "PRÓXIMA ACCIÓN")} value={selected.nextAction || "—"} />
            </div>

            <TaskList
              tasks={tasks}
              onCompleted={(taskId) => {
                startTransition(() => setTasks((prev) => prev.filter((tk) => tk.id !== taskId)));
                router.refresh();
              }}
            />

            <div className="rounded-xl border border-brand-100 bg-brand-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-text-primary">
                  <Sparkles className="h-4 w-4 text-brand" /> {t("AI Smart Analysis", "Análisis Inteligente IA")}
                </div>
                <Button size="sm" disabled title={t("Coming soon", "Próximamente")}>
                  <Sparkles className="h-3.5 w-3.5" /> {t("Analyze activity with AI", "Analizar actividad con IA")}
                </Button>
              </div>
            </div>

            <div>
              <p className="mb-3 text-[15px] font-semibold text-text-primary">{t("Omnichannel history", "Historial omnicanal")}</p>

              <NoteComposer
                key={selected.id}
                contactId={selected.id}
                onAdded={(newActivity) => {
                  startTransition(() => setActivities((prev) => [newActivity, ...prev]));
                  router.refresh();
                }}
              />

              <div className="mt-4 flex flex-wrap gap-2">
                {historyTabs.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setHistoryTab(tab)}
                    className={cn(
                      "rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors",
                      historyTab === tab
                        ? "bg-text-primary text-white"
                        : "bg-white border border-border text-text-secondary hover:bg-surface-muted"
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="mt-4 flex flex-col gap-2">
                {activitiesLoading && (
                  <p className="py-4 text-center text-[13px] text-text-tertiary">{t("Loading...", "Cargando...")}</p>
                )}
                {!activitiesLoading &&
                  filteredActivities.map((a) => {
                    const Icon = channelIcon[a.channel ?? a.type] ?? MessageCircle;
                    const channelLabel = CHANNEL_OPTIONS.find((c) => c.channel === a.channel);
                    const typeLabel = channelLabel
                      ? language === "es"
                        ? channelLabel.labelEs
                        : channelLabel.labelEn
                      : a.type === "NOTE"
                        ? t("Note", "Nota")
                        : a.type;
                    const outcomeLabel = a.outcome ? stageLabels[a.outcome as Stage] ?? a.outcome : null;
                    return (
                      <div key={a.id} className="flex items-center gap-3 rounded-xl border border-border p-3.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold text-text-primary">
                            {typeLabel}
                            {outcomeLabel ? ` · ${outcomeLabel}` : ""}
                          </p>
                          <p className="truncate text-[12px] text-text-secondary">{a.notes || a.authorName}</p>
                        </div>
                        <span className="shrink-0 text-[12px] text-text-tertiary" suppressHydrationWarning>
                          {formatRelativeTime(a.createdAt, language)}
                        </span>
                      </div>
                    );
                  })}
                {!activitiesLoading && filteredActivities.length === 0 && (
                  <p className="rounded-xl border border-dashed border-border py-6 text-center text-[13px] text-text-tertiary">
                    {t("No activity recorded for this contact.", "No hay actividad registrada para este contacto.")}
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Classify panel */}
        {selected && (
          <ClassifyPanel
            key={selected.id}
            contact={selected}
            stages={classifyStages}
            users={assignableUsers}
            onSaved={(newActivity) => {
              startTransition(() => setActivities((prev) => [newActivity, ...prev]));
              router.refresh();
            }}
          />
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t("New contact", "Nuevo contacto")}>
        <ContactForm
          companies={companies}
          onSubmit={async (values) => {
            const stageId = stages[0]?.id;
            if (!stageId) return { error: "No pipeline stage configured." };
            const result = await createContactAction({ ...values, pipelineStageId: stageId });
            if (result.ok) {
              setCreateOpen(false);
              router.refresh();
            }
            return result;
          }}
          submitLabel={t("Create contact", "Crear contacto")}
        />
      </Modal>

      {selected && (
        <Modal open={editOpen} onClose={() => setEditOpen(false)} title={t("Edit contact", "Editar contacto")}>
          <ContactForm
            initial={selected}
            onSubmit={async (values) => {
              const result = await updateContactAction(selected.id, values);
              if (result.ok) {
                setEditOpen(false);
                router.refresh();
              }
              return result;
            }}
            submitLabel={t("Save changes", "Guardar cambios")}
          />
        </Modal>
      )}

      {selected && (
        <Modal open={taskOpen} onClose={() => setTaskOpen(false)} title={t("New task", "Nueva tarea")}>
          <TaskForm
            contactId={selected.id}
            users={assignableUsers}
            onSubmit={async (values) => {
              const result = await createTaskAction({ contactId: selected.id, ...values });
              if (result.ok && result.task) {
                const newTask = result.task;
                setTaskOpen(false);
                // Not wrapped in startTransition: closing the modal (setTaskOpen) is an
                // urgent update issued in the same tick, and the router.refresh() right
                // after preempts a low-priority transition before it ever commits — the
                // task silently never appears until something else re-renders the tree.
                setTasks((prev) => [...prev, newTask]);
                router.refresh();
              }
              return result;
            }}
          />
        </Modal>
      )}

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title={t("Import contacts", "Importar contactos")}
        className="max-w-2xl"
      >
        <ImportContactsPanel
          companies={companies}
          defaultCompanyId={companies.find((c) => c.name === activeCompany)?.id}
          pipelineStageId={stages[0]?.id}
          onImported={() => {
            setImportOpen(false);
            router.refresh();
          }}
        />
      </Modal>
    </div>
  );
}

function InfoField({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-text-tertiary">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-1 truncate text-[14px] font-medium text-text-primary">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">{label}</label>
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Pipeline board — contacts grouped into columns by stage; move via a
// per-card select rather than drag-and-drop, to avoid a new dependency.
// -----------------------------------------------------------------------------

function PipelineBoard({
  stages,
  contacts,
  onSelect,
  onMoved,
}: {
  stages: PipelineStage[];
  contacts: ContactWithJoins[];
  onSelect: (id: string) => void;
  onMoved: () => void;
}) {
  const { t, language } = useLanguage();
  const stageLabels = language === "es" ? STAGE_LABEL_ES : STAGE_LABEL;

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {stages.map((stage) => {
        const stageContacts = contacts.filter((c) => c.stageKey === stage.key);
        return (
          <div key={stage.id} className="flex w-[260px] shrink-0 flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <p className="text-[13px] font-semibold text-text-primary">{stageLabels[stage.key as Stage] ?? stage.key}</p>
              <Badge tone="gray">{stageContacts.length}</Badge>
            </div>
            <div className="flex flex-col gap-2">
              {stageContacts.map((c) => (
                <PipelineCard key={c.id} contact={c} stages={stages} onSelect={onSelect} onMoved={onMoved} />
              ))}
              {stageContacts.length === 0 && (
                <p className="rounded-xl border border-dashed border-border py-6 text-center text-[12px] text-text-tertiary">
                  {t("No contacts", "Sin contactos")}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PipelineCard({
  contact,
  stages,
  onSelect,
  onMoved,
}: {
  contact: ContactWithJoins;
  stages: PipelineStage[];
  onSelect: (id: string) => void;
  onMoved: () => void;
}) {
  const { language } = useLanguage();
  const [moving, setMoving] = useState(false);

  async function handleMove(pipelineStageId: string) {
    if (!pipelineStageId || pipelineStageId === contact.pipelineStageId) return;
    setMoving(true);
    const result = await moveContactStageAction(contact.id, pipelineStageId);
    setMoving(false);
    if (result.ok) onMoved();
  }

  return (
    <Card className="flex flex-col gap-2.5 p-3.5">
      <button onClick={() => onSelect(contact.id)} className="flex items-center gap-2.5 text-left">
        <Avatar name={contact.name} size={30} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-text-primary">{contact.name}</p>
          <p className="truncate text-[11.5px] text-text-secondary">{contact.companyName}</p>
        </div>
      </button>
      <Select
        value={contact.pipelineStageId}
        disabled={moving}
        onChange={(e) => handleMove(e.target.value)}
        className="h-8 text-[12px]"
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {(language === "es" ? STAGE_LABEL_ES : STAGE_LABEL)[s.key as Stage] ?? s.key}
          </option>
        ))}
      </Select>
      <p className="text-[11px] text-text-tertiary" suppressHydrationWarning>
        {formatRelativeTime(contact.lastContactAt, language)}
      </p>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Note composer — logs a plain NOTE activity without touching stage/owner
// -----------------------------------------------------------------------------

function NoteComposer({ contactId, onAdded }: { contactId: string; onAdded: (activity: ActivityWithAuthor) => void }) {
  const { t } = useLanguage();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!notes.trim()) return;
    setSaving(true);
    setError(undefined);
    const result = await addNoteAction(contactId, notes);
    setSaving(false);
    if (result.error || !result.activity) {
      setError(result.error ?? t("Something went wrong.", "Algo salió mal."));
      return;
    }
    onAdded(result.activity);
    setNotes("");
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        rows={2}
        placeholder={t("Add a note...", "Añadir una nota...")}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="flex items-center justify-between gap-3">
        {error && <p className="text-[12.5px] text-danger">{error}</p>}
        <Button size="sm" className="ml-auto" disabled={saving || !notes.trim()} onClick={handleAdd}>
          {saving ? t("Saving...", "Guardando...") : t("Add note", "Añadir nota")}
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Open tasks list + create-task form — contact-level task tracking (Phase 9)
// -----------------------------------------------------------------------------

const PRIORITY_OPTIONS = [
  { value: "LOW", labelEn: "Low", labelEs: "Baja" },
  { value: "MEDIUM", labelEn: "Medium", labelEs: "Media" },
  { value: "HIGH", labelEn: "High", labelEs: "High" },
  { value: "URGENT", labelEn: "Urgent", labelEs: "Urgente" },
];

const priorityTone: Record<string, "green" | "amber" | "red" | "gray" | "blue"> = {
  LOW: "gray",
  MEDIUM: "blue",
  HIGH: "amber",
  URGENT: "red",
};

function TaskList({ tasks, onCompleted }: { tasks: TaskWithAssignee[]; onCompleted: (taskId: string) => void }) {
  const { t, language } = useLanguage();
  const [completingId, setCompletingId] = useState<string | null>(null);

  async function handleComplete(taskId: string) {
    setCompletingId(taskId);
    const result = await completeTaskAction(taskId);
    setCompletingId(null);
    if (result.ok) onCompleted(taskId);
  }

  if (tasks.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-semibold text-text-primary">{t("Open tasks", "Tareas abiertas")}</p>
      {tasks.map((tk) => (
        <div key={tk.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
          <button
            onClick={() => handleComplete(tk.id)}
            disabled={completingId === tk.id}
            aria-label={t("Mark complete", "Marcar como completada")}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-text-tertiary hover:border-brand hover:text-brand disabled:opacity-40"
          >
            <CheckCircle2 className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-text-primary">{tk.title}</p>
            <p className="truncate text-[12px] text-text-secondary">
              {tk.assignedUserName || t("Unassigned", "Sin asignar")}
              {tk.dueAt ? ` · ${formatDateTime(tk.dueAt, language)}` : ""}
            </p>
          </div>
          {tk.priority && (
            <Badge tone={priorityTone[tk.priority] ?? "gray"}>
              {PRIORITY_OPTIONS.find((p) => p.value === tk.priority)?.[language === "es" ? "labelEs" : "labelEn"] ?? tk.priority}
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}

function TaskForm({
  users,
  onSubmit,
}: {
  contactId: string;
  users: UserWithRole[];
  onSubmit: (values: { title: string; assignedUserId: string; priority: string; dueAt: string }) => Promise<{ error?: string; ok?: true }>;
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    const result = await onSubmit({ title, assignedUserId, priority, dueAt });
    setSaving(false);
    if (result.error) setError(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label={t("TITLE", "TÍTULO")}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </Field>
      <Field label={t("ASSIGNED TO", "ASIGNADO A")}>
        <Select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)}>
          <option value="">{t("Unassigned", "Sin asignar")}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("PRIORITY", "PRIORIDAD")}>
        <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.labelEn}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("DUE DATE", "FECHA LÍMITE")}>
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="h-10 w-full rounded-lg border border-border bg-white px-3.5 text-[14px] text-text-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
      </Field>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <Button type="submit" disabled={saving || !title.trim()} className="mt-1 w-full">
        {saving ? t("Saving...", "Guardando...") : t("Create task", "Crear tarea")}
      </Button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Classify contact panel — updates stage/owner/next-action and appends an Activity
// -----------------------------------------------------------------------------

function ClassifyPanel({
  contact,
  stages,
  users,
  onSaved,
}: {
  contact: ContactWithJoins;
  stages: PipelineStage[];
  users: UserWithRole[];
  onSaved: (activity: ActivityWithAuthor) => void;
}) {
  const { t } = useLanguage();
  const [channel, setChannel] = useState(CHANNEL_OPTIONS[0].value);
  const [stageId, setStageId] = useState(stages.find((s) => s.key === contact.stageKey)?.id ?? stages[0]?.id ?? "");
  const [nextAction, setNextAction] = useState("");
  const [assignedUserId, setAssignedUserId] = useState(contact.assignedUserId ?? "");
  const [notes, setNotes] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const nextActionOptions = [
    { value: t("Call back", "Volver a llamar") },
    { value: t("Send catalog", "Enviar catálogo") },
    { value: t("Sales visit", "Visita comercial") },
    { value: t("Send quote", "Enviar presupuesto") },
  ];

  async function handleSave() {
    const channelOpt = CHANNEL_OPTIONS.find((c) => c.value === channel)!;
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) {
      setError(t("Select a stage.", "Selecciona una etapa."));
      return;
    }
    setSaving(true);
    setError(undefined);
    const result = await classifyContactAction(contact.id, {
      pipelineStageId: stageId,
      assignedUserId,
      nextAction,
      followUpAt,
      activityType: channelOpt.type,
      activityChannel: channelOpt.channel,
      outcome: stage.key,
      notes,
    });
    setSaving(false);
    if (result.error || !result.activity) {
      setError(result.error ?? t("Something went wrong.", "Algo salió mal."));
      return;
    }
    onSaved(result.activity);
    setNotes("");
    setFollowUpAt("");
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <Badge tone="green" className="w-fit">
        {t("New interaction", "Nueva interacción")}
      </Badge>
      <h3 className="text-[16px] font-semibold text-text-primary">{t("Classify contact", "Clasificar contacto")}</h3>

      <Field label={t("CHANNEL USED", "CANAL UTILIZADO")}>
        <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
          {CHANNEL_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.labelEn}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("CONTACT RESULT", "RESULTADO DE CONTACTO")}>
        <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {STAGE_LABEL[s.key as Stage] ?? s.key}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("NEXT ACTION", "PRÓXIMA ACCIÓN")}>
        <Select value={nextAction} onChange={(e) => setNextAction(e.target.value)}>
          <option value="">—</option>
          {nextActionOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("RESPONSIBLE", "RESPONSABLE")}>
        <Select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)}>
          <option value="">{t("Unassigned", "Sin asignar")}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("NOTES", "NOTAS")}>
        <Textarea rows={3} placeholder={t("Interaction notes...", "Notas de la interacción...")} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <Field label={t("FOLLOW-UP DATE", "FECHA DE SEGUIMIENTO")}>
        <input
          type="datetime-local"
          value={followUpAt}
          onChange={(e) => setFollowUpAt(e.target.value)}
          className="h-10 w-full rounded-lg border border-border bg-white px-3.5 text-[14px] text-text-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
      </Field>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <Button className="mt-1 w-full" disabled={saving} onClick={handleSave}>
        {saving ? t("Saving...", "Guardando...") : t("Save classification", "Guardar clasificación")}
      </Button>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Create / edit contact form (shared shape, different submit behavior)
// -----------------------------------------------------------------------------

function ContactForm({
  initial,
  companies,
  onSubmit,
  submitLabel,
}: {
  initial?: ContactWithJoins;
  companies?: CompanyOption[];
  onSubmit: (values: {
    companyId: string;
    name: string;
    businessName: string;
    phone: string;
    email: string;
    leadSource: string;
  }) => Promise<{ error?: string; ok?: true }>;
  submitLabel: string;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState(initial?.name ?? "");
  const [businessName, setBusinessName] = useState(initial?.businessName ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [leadSource, setLeadSource] = useState(initial?.leadSource ?? "");
  const [companyId, setCompanyId] = useState(initial?.companyId ?? companies?.[0]?.id ?? "");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    const result = await onSubmit({ companyId, name, businessName, phone, email, leadSource });
    setSaving(false);
    if (result.error) setError(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {companies && (
        <Field label={t("COMPANY", "EMPRESA")}>
          <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t("NAME", "NOMBRE")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label={t("BUSINESS NAME", "NOMBRE DE EMPRESA")}>
        <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
      </Field>
      <Field label={t("PHONE", "TELÉFONO")}>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label={t("EMAIL", "EMAIL")}>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label={t("SOURCE", "ORIGEN")}>
        <Input value={leadSource} onChange={(e) => setLeadSource(e.target.value)} placeholder={t("e.g. Referral, Website", "Ej. Referido, Web")} />
      </Field>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <Button type="submit" disabled={saving} className="mt-1 w-full">
        {saving ? t("Saving...", "Guardando...") : submitLabel}
      </Button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// CSV contact import — parsed and previewed in the browser (see
// @/lib/contactsImport, shared with the Campaigns member import), then
// bulk-created via one server action call once the user confirms.
// -----------------------------------------------------------------------------

type ImportRow = ContactImportRow;

function ImportContactsPanel({
  companies,
  defaultCompanyId,
  pipelineStageId,
  onImported,
}: {
  companies: CompanyOption[];
  defaultCompanyId?: string;
  pipelineStageId?: string;
  onImported: () => void;
}) {
  const { t } = useLanguage();
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? "");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
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
    if (!companyId) {
      setError(t("Choose a company first.", "Elige una empresa primero."));
      return;
    }
    if (!pipelineStageId) {
      setError(t("No pipeline stage configured.", "No hay una etapa de pipeline configurada."));
      return;
    }
    setImporting(true);
    setError(undefined);
    const rowsToSend = validRows.slice(0, MAX_CONTACTS_IMPORT_ROWS).map((r) => ({
      name: r.name,
      businessName: r.businessName,
      phone: r.phone,
      email: r.email,
      leadSource: r.leadSource,
    }));
    const res = await importContactsAction(companyId, pipelineStageId, rowsToSend);
    setImporting(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setResult(res.created ?? 0);
  }

  function handleReset() {
    setFileName("");
    setRows(null);
    setFileError(undefined);
    setError(undefined);
    setResult(null);
  }

  if (result !== null) {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <p className="text-[15px] font-semibold text-text-primary">
          {t(
            `${result} contact${result === 1 ? "" : "s"} imported.`,
            `${result} contacto${result === 1 ? "" : "s"} importado${result === 1 ? "" : "s"}.`
          )}
        </p>
        <Button onClick={onImported}>{t("Done", "Listo")}</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("COMPANY", "EMPRESA")}>
          <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">{t("Choose a company", "Elige una empresa")}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline"
          >
            <Download className="h-3.5 w-3.5" /> {t("Download CSV template", "Descargar plantilla CSV")}
          </button>
        </div>
      </div>

      <p className="text-[12.5px] text-text-tertiary">
        {t(
          "Expected columns: Name (required), Business Name, Phone, Email, Source.",
          "Columnas esperadas: Name (obligatorio), Business Name, Phone, Email, Source."
        )}
      </p>

      {!rows && (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-8 text-center hover:bg-surface-muted">
          <Upload className="h-6 w-6 text-text-tertiary" />
          <span className="text-[13.5px] font-medium text-text-primary">
            {fileName || t("Click to choose a CSV file", "Haz clic para elegir un archivo CSV")}
          </span>
          <input type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
        </label>
      )}

      {fileError && (
        <p className="flex items-center gap-1.5 text-[13px] text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" /> {fileError}
        </p>
      )}

      {rows && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-text-secondary">
              {t(
                `${validRows.length} valid, ${invalidCount} invalid row(s) in ${fileName}.`,
                `${validRows.length} válidas, ${invalidCount} inválida(s) en ${fileName}.`
              )}
            </p>
            <button
              type="button"
              onClick={handleReset}
              className="text-[12.5px] font-medium text-text-tertiary hover:text-text-primary"
            >
              {t("Choose a different file", "Elegir otro archivo")}
            </button>
          </div>

          {truncated && (
            <p className="text-[12.5px] text-warning-700">
              {t(
                `Only the first ${MAX_CONTACTS_IMPORT_ROWS} valid rows will be imported.`,
                `Solo se importarán las primeras ${MAX_CONTACTS_IMPORT_ROWS} filas válidas.`
              )}
            </p>
          )}

          <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
            <table className="w-full text-left text-[12.5px]">
              <thead className="sticky top-0 bg-surface-muted text-text-tertiary">
                <tr>
                  <th className="px-3 py-2 font-semibold">{t("Name", "Nombre")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Business", "Empresa")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Phone", "Teléfono")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Email", "Email")}</th>
                  <th className="px-3 py-2 font-semibold">{t("Status", "Estado")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={cn("border-t border-border", !r.valid && "bg-danger-50")}>
                    <td className="truncate px-3 py-2">{r.name || "—"}</td>
                    <td className="truncate px-3 py-2">{r.businessName || "—"}</td>
                    <td className="truncate px-3 py-2">{r.phone || "—"}</td>
                    <td className="truncate px-3 py-2">{r.email || "—"}</td>
                    <td className="px-3 py-2">
                      {r.valid ? (
                        <span className="text-success">{t("Valid", "Válida")}</span>
                      ) : (
                        <span className="text-danger">{r.reason}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <Button className="w-full" disabled={!rows || validRows.length === 0 || importing} onClick={handleImport}>
        {importing
          ? t("Importing...", "Importando...")
          : t(
              `Import ${Math.min(validRows.length, MAX_CONTACTS_IMPORT_ROWS)} contacts`,
              `Importar ${Math.min(validRows.length, MAX_CONTACTS_IMPORT_ROWS)} contactos`
            )}
      </Button>
    </div>
  );
}
