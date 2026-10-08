"use client";

import { useState } from "react";
import { Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Select, Textarea, Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/PageHeader";
import { useLanguage } from "@/context/LanguageContext";
import { useCompany, ALL_COMPANIES } from "@/context/CompanyContext";
import { cn } from "@/lib/cn";
import type { TicketWithJoins } from "@/server/repositories/tickets";
import type { TicketMessageWithAuthor } from "@/server/repositories/ticketMessages";
import type { UserWithRole } from "@/server/repositories/users";
import { TICKET_STATUSES, TICKET_PRIORITIES, type TicketStatus, type TicketPriority } from "@/server/constants";
import {
  createTicketAction,
  updateTicketStatusAction,
  updateTicketAssigneeAction,
  addTicketMessageAction,
  getTicketOwnerOptionsAction,
  getTicketDetailAction,
} from "./actions";

type CompanyOption = { id: string; name: string };

const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: "Open",
  IN_PROCESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};
const STATUS_LABEL_ES: Record<TicketStatus, string> = {
  OPEN: "Abierto",
  IN_PROCESS: "En proceso",
  RESOLVED: "Resuelto",
  CLOSED: "Cerrado",
};
const STATUS_TONE: Record<TicketStatus, "green" | "amber" | "blue" | "gray"> = {
  OPEN: "green",
  IN_PROCESS: "amber",
  RESOLVED: "blue",
  CLOSED: "gray",
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};
const PRIORITY_LABEL_ES: Record<TicketPriority, string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};
const PRIORITY_TONE: Record<TicketPriority, "gray" | "blue" | "amber" | "red"> = {
  LOW: "gray",
  MEDIUM: "blue",
  HIGH: "amber",
  CRITICAL: "red",
};

export function SoporteClient({
  tickets,
  companies,
  initialSelectedId,
  initialMessages,
  currentUserId,
}: {
  tickets: TicketWithJoins[];
  companies: CompanyOption[];
  initialSelectedId: string | null;
  initialMessages: TicketMessageWithAuthor[];
  currentUserId: string;
}) {
  const { t, language } = useLanguage();
  const { activeCompany, setActiveCompany } = useCompany();
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [messages, setMessages] = useState<TicketMessageWithAuthor[]>(initialMessages);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const statusLabels = language === "es" ? STATUS_LABEL_ES : STATUS_LABEL;
  const priorityLabels = language === "es" ? PRIORITY_LABEL_ES : PRIORITY_LABEL;

  const companyScoped =
    activeCompany === ALL_COMPANIES ? tickets : tickets.filter((tk) => tk.companyName === activeCompany);
  const list = tab === "all" ? companyScoped : companyScoped.filter((tk) => tk.createdBy === currentUserId);
  // Looked up from the company-scoped list (not raw `tickets`): a ticket
  // selected before switching companies must stop showing once it's out of
  // scope, falling back to the empty state instead of another company's data.
  const selected = companyScoped.find((tk) => tk.id === selectedId);

  async function selectTicket(id: string) {
    setSelectedId(id);
    setMessages([]);
    setLoadingMessages(true);
    const result = await getTicketDetailAction(id);
    setMessages(result?.messages ?? []);
    setLoadingMessages(false);
  }

  function appendMessage(msg: TicketMessageWithAuthor) {
    setMessages((prev) => [...prev, msg]);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Technical Support", "Soporte Técnico")}
        subtitle={t("Create, view and respond to technical incidents", "Crea, visualiza y responde a incidencias técnicas")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> {t("Create ticket", "Crear ticket")}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
        <div className="flex flex-col gap-4">
          <div className="w-[220px]">
            <Select value={activeCompany} onChange={(e) => setActiveCompany(e.target.value)}>
              <option value={ALL_COMPANIES}>{t("All companies", "Todas las empresas")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex rounded-lg bg-surface-muted p-1">
            <button
              onClick={() => setTab("all")}
              className={cn(
                "flex-1 rounded-md py-1.5 text-[13.5px] font-medium transition-colors",
                tab === "all" ? "bg-brand-50 text-brand-700" : "text-text-secondary hover:text-text-primary"
              )}
            >
              {t("All", "Todos")}
            </button>
            <button
              onClick={() => setTab("mine")}
              className={cn(
                "flex-1 rounded-md py-1.5 text-[13.5px] font-medium transition-colors",
                tab === "mine" ? "bg-brand-50 text-brand-700" : "text-text-secondary hover:text-text-primary"
              )}
            >
              {t("My tickets", "Mis tickets")}
            </button>
          </div>

          {list.length === 0 ? (
            <p className="py-6 text-center text-[13.5px] text-text-tertiary">
              {t("No tickets yet. Create the first one.", "Aún no hay tickets. Crea el primero.")}
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {list.map((tk) => (
                <button
                  key={tk.id}
                  onClick={() => selectTicket(tk.id)}
                  className={cn(
                    "rounded-xl border p-4 text-left transition-colors",
                    selectedId === tk.id
                      ? "border-brand-100 bg-brand-50"
                      : "border-border bg-white hover:bg-surface-muted"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12.5px] font-medium text-text-secondary">
                      #{tk.ticketNumber} · {tk.companyName}
                    </p>
                    <Badge tone={PRIORITY_TONE[tk.priority as TicketPriority]}>
                      {priorityLabels[tk.priority as TicketPriority]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[14.5px] font-semibold text-text-primary">{tk.subject}</p>
                  <Badge tone={STATUS_TONE[tk.status as TicketStatus]} className="mt-2">
                    {statusLabels[tk.status as TicketStatus]}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected ? (
          <TicketDetailPanel
            key={selected.id}
            ticket={selected}
            messages={messages}
            loadingMessages={loadingMessages}
            currentUserId={currentUserId}
            onMessageSent={appendMessage}
          />
        ) : (
          <Card className="flex items-center justify-center p-6 text-[13.5px] text-text-tertiary">
            {t("Select a ticket to view details.", "Selecciona un ticket para ver los detalles.")}
          </Card>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t("Create ticket", "Crear ticket")}>
        <CreateTicketForm companies={companies} onClose={() => setCreateOpen(false)} />
      </Modal>
    </div>
  );
}

function TicketDetailPanel({
  ticket,
  messages,
  loadingMessages,
  currentUserId,
  onMessageSent,
}: {
  ticket: TicketWithJoins;
  messages: TicketMessageWithAuthor[];
  loadingMessages: boolean;
  currentUserId: string;
  onMessageSent: (msg: TicketMessageWithAuthor) => void;
}) {
  const { t, language } = useLanguage();
  const statusLabels = language === "es" ? STATUS_LABEL_ES : STATUS_LABEL;

  const [status, setStatus] = useState<TicketStatus>(ticket.status as TicketStatus);
  const [statusPending, setStatusPending] = useState(false);

  const [assigneeId, setAssigneeId] = useState(ticket.assigneeId ?? "");
  const [assigneeName, setAssigneeName] = useState(ticket.assigneeName ?? "");
  const [owners, setOwners] = useState<UserWithRole[]>([]);
  const [ownersLoaded, setOwnersLoaded] = useState(false);
  const [assigneePending, setAssigneePending] = useState(false);

  const [reply, setReply] = useState("");
  const [replyPending, setReplyPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function loadOwners() {
    if (ownersLoaded) return;
    const result = await getTicketOwnerOptionsAction(ticket.companyId);
    setOwners(result.users);
    setOwnersLoaded(true);
  }

  async function handleStatusChange(next: TicketStatus) {
    setStatusPending(true);
    setError(undefined);
    const result = await updateTicketStatusAction(ticket.id, next);
    setStatusPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setStatus(next);
  }

  async function handleAssigneeChange(next: string) {
    setAssigneePending(true);
    setError(undefined);
    const result = await updateTicketAssigneeAction(ticket.id, next);
    setAssigneePending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setAssigneeId(next);
    setAssigneeName(owners.find((o) => o.id === next)?.fullName ?? "");
  }

  async function handleReply() {
    if (!reply.trim()) return;
    setReplyPending(true);
    setError(undefined);
    const result = await addTicketMessageAction(ticket.id, reply);
    setReplyPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onMessageSent({
      id: `optimistic-${Date.now()}`,
      ticketId: ticket.id,
      authorId: currentUserId,
      body: reply,
      createdAt: new Date(),
      authorName: t("You", "Tú"),
    });
    setReply("");
  }

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-[18px] font-semibold text-text-primary">
            #{ticket.ticketNumber} · {ticket.subject}
          </h2>
          <p className="mt-1 text-[13px] text-text-secondary">
            {ticket.companyName} · {t("Created by", "Creado por")} {ticket.createdByName}
          </p>
          {ticket.description && <p className="mt-2 text-[13.5px] text-text-primary">{ticket.description}</p>}
        </div>
        <div className="flex gap-2">
          <div className="w-[170px]" onFocus={loadOwners} onClick={loadOwners}>
            <Select value={assigneeId} disabled={assigneePending} onChange={(e) => handleAssigneeChange(e.target.value)}>
              <option value="">{assigneeName || t("Unassigned", "Sin asignar")}</option>
              {owners
                .filter((o) => o.id !== assigneeId)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.fullName}
                  </option>
                ))}
            </Select>
          </div>
          <div className="w-[150px]">
            <Select value={status} disabled={statusPending} onChange={(e) => handleStatusChange(e.target.value as TicketStatus)}>
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <div className="flex flex-1 flex-col gap-4">
        {loadingMessages ? (
          <p className="py-6 text-center text-[13.5px] text-text-tertiary">{t("Loading...", "Cargando...")}</p>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-[13.5px] text-text-tertiary">
            {t("No messages yet.", "Aún no hay mensajes.")}
          </p>
        ) : (
          messages.map((msg) =>
            msg.authorId === currentUserId ? (
              <div key={msg.id} className="ml-auto flex max-w-[80%] flex-col items-end gap-1">
                <div className="rounded-2xl rounded-tr-sm bg-brand-50 px-4 py-2.5 text-[13.5px] text-text-primary">
                  {msg.body}
                </div>
                <p className="text-[11.5px] text-text-tertiary">{t("You", "Tú")}</p>
              </div>
            ) : (
              <div key={msg.id} className="flex items-start gap-3">
                <Avatar name={msg.authorName} size={32} />
                <div>
                  <div className="rounded-2xl rounded-tl-sm bg-surface-muted px-4 py-2.5 text-[13.5px] text-text-primary">
                    {msg.body}
                  </div>
                  <p className="mt-1 text-[11.5px] text-text-tertiary">{msg.authorName}</p>
                </div>
              </div>
            )
          )
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <Textarea
          rows={3}
          placeholder={t(
            "Write a response or add information about the incident...",
            "Escribe una respuesta o añade información sobre la incidencia..."
          )}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
        />
        <Button className="w-fit self-end" disabled={replyPending || !reply.trim()} onClick={handleReply}>
          <Send className="h-4 w-4" /> {replyPending ? t("Sending...", "Enviando...") : t("Reply to ticket", "Responder ticket")}
        </Button>
      </div>
    </Card>
  );
}

function CreateTicketForm({ companies, onClose }: { companies: CompanyOption[]; onClose: () => void }) {
  const { t, language } = useLanguage();
  const priorityLabels = language === "es" ? PRIORITY_LABEL_ES : PRIORITY_LABEL;
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("MEDIUM");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    const result = await createTicketAction({ companyId, subject, description, priority });
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
        <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
          {t("SUBJECT", "ASUNTO")}
        </label>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} required autoFocus />
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
          {t("DESCRIPTION", "DESCRIPCIÓN")}
        </label>
        <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
          {t("PRIORITY", "PRIORIDAD")}
        </label>
        <Select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {priorityLabels[p]}
            </option>
          ))}
        </Select>
      </div>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <Button type="submit" disabled={saving} className="mt-1 w-full">
        {saving ? t("Creating...", "Creando...") : t("Create ticket", "Crear ticket")}
      </Button>
    </form>
  );
}
