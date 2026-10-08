"use client";

import { useState } from "react";
import { Send, AtSign } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SearchInput, Select, Textarea } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { PageHeader } from "@/components/PageHeader";
import { useLanguage } from "@/context/LanguageContext";
import { useCompany, ALL_COMPANIES } from "@/context/CompanyContext";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ConversationWithJoins } from "@/server/repositories/conversations";
import type { Message } from "@/server/repositories/messages";
import type { ContactWithJoins } from "@/server/repositories/contacts";
import type { UserWithRole } from "@/server/repositories/users";
import {
  getConversationDetailAction,
  replyToConversationAction,
  linkContactAction,
  updateConversationAssigneeAction,
  getAssignableUsersAction,
} from "./actions";

export function RedesSocialesClient({
  conversations: initialConversations,
  contacts,
  initialSelectedId,
  initialMessages,
}: {
  conversations: ConversationWithJoins[];
  contacts: ContactWithJoins[];
  initialSelectedId: string | null;
  initialMessages: Message[];
}) {
  const { t } = useLanguage();
  const { activeCompany, setActiveCompany } = useCompany();
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const filtered = conversations.filter((c) => activeCompany === ALL_COMPANIES || c.companyName === activeCompany);
  // Looked up from the company-scoped list (not raw `conversations`): a
  // conversation selected before switching companies must stop showing once
  // it's out of scope, falling back to the empty state instead of another
  // company's data.
  const selected = filtered.find((c) => c.id === selectedId);

  function applyConversationUpdate(updated: ConversationWithJoins) {
    setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  async function selectConversation(id: string) {
    setSelectedId(id);
    setMessages([]);
    setLoadingDetail(true);
    const result = await getConversationDetailAction(id);
    if (result) {
      setMessages(result.messages);
      applyConversationUpdate(result.conversation);
    }
    setLoadingDetail(false);
  }

  async function refreshDetail() {
    if (!selectedId) return;
    const result = await getConversationDetailAction(selectedId);
    if (result) {
      setMessages(result.messages);
      applyConversationUpdate(result.conversation);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Social Media", "Redes Sociales")}
        subtitle={t("Social inbox and comment responses", "Bandeja social y respuesta a comentarios")}
        actions={<SearchInput placeholder={t("Search client, phone or email...", "Buscar cliente, teléfono o correo...")} className="max-w-sm" />}
      />

      <div className="w-[220px]">
        <Select value={activeCompany} onChange={(e) => setActiveCompany(e.target.value)}>
          <option value={ALL_COMPANIES}>{t("All companies", "Todas las empresas")}</option>
          {[...new Set(conversations.map((c) => c.companyName))].map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr_280px]">
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <CardTitle>{t("Social inbox", "Bandeja social")}</CardTitle>
            <Badge tone="green">{filtered.length}</Badge>
          </div>

          <div className="flex flex-col gap-1">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => selectConversation(c.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors",
                  selectedId === c.id ? "bg-brand-50" : "hover:bg-surface-muted"
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand">
                  <AtSign className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-text-primary">
                    {c.contactName ?? c.subject ?? t("Unknown sender", "Remitente desconocido")}
                  </span>
                  {!c.contactId && (
                    <span className="text-[11px] text-warning-700">{t("Unmatched", "Sin asociar")}</span>
                  )}
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="py-6 text-center text-[13px] text-text-tertiary">
                {t("No social messages yet. They'll appear here once the channel is connected.", "Aún no hay mensajes. Aparecerán aquí cuando el canal esté conectado.")}
              </p>
            )}
          </div>
        </Card>

        {selected ? (
          <>
            <ConversationPanel
              key={selected.id}
              conversation={selected}
              messages={messages}
              loadingDetail={loadingDetail}
              onSent={refreshDetail}
            />
            <SidePanel key={`${selected.id}-side`} conversation={selected} contacts={contacts} onLinked={refreshDetail} />
          </>
        ) : (
          <Card className="flex items-center justify-center p-6 text-[13.5px] text-text-tertiary lg:col-span-2">
            {t("Select a conversation to view it.", "Selecciona una conversación para verla.")}
          </Card>
        )}
      </div>
    </div>
  );
}

function ConversationPanel({
  conversation,
  messages,
  loadingDetail,
  onSent,
}: {
  conversation: ConversationWithJoins;
  messages: Message[];
  loadingDetail: boolean;
  onSent: () => void;
}) {
  const { t, language } = useLanguage();
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSend() {
    setSending(true);
    setError(undefined);
    const result = await replyToConversationAction(conversation.id, reply);
    setSending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setReply("");
    onSent();
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <p className="text-[15px] font-semibold text-text-primary">
          {conversation.contactName ?? conversation.subject ?? t("Unknown sender", "Remitente desconocido")}
        </p>
        <p className="text-[12.5px] text-text-secondary">{t("Social", "Red social")}</p>
      </div>

      <div className="flex max-h-[360px] flex-col gap-3 overflow-y-auto">
        {loadingDetail ? (
          <p className="py-6 text-center text-[13.5px] text-text-tertiary">{t("Loading...", "Cargando...")}</p>
        ) : messages.length === 0 ? (
          <p className="rounded-2xl bg-surface-muted px-4 py-3 text-center text-[13.5px] text-text-tertiary">
            {t("No messages in this conversation yet.", "Aún no hay mensajes en esta conversación.")}
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "max-w-[75%] rounded-2xl px-4 py-3 text-[14px]",
                m.direction === "OUTBOUND" ? "ml-auto bg-brand text-white" : "bg-surface-muted text-text-primary"
              )}
            >
              <p>{m.body}</p>
              <p className={cn("mt-1 text-[11px]", m.direction === "OUTBOUND" ? "text-brand-light" : "text-text-tertiary")}>
                {m.direction === "OUTBOUND" ? t("You", "Tú") : (m.senderLabel ?? "")} · {formatRelativeTime(m.sentAt, language)}
              </p>
            </div>
          ))
        )}
      </div>

      <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
        <Textarea rows={3} placeholder={t("Write a reply...", "Escribe una respuesta...")} value={reply} onChange={(e) => setReply(e.target.value)} />
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <Button className="w-fit self-end" disabled={sending} onClick={handleSend}>
          <Send className="h-4 w-4" /> {sending ? t("Sending...", "Enviando...") : t("Post reply", "Publicar respuesta")}
        </Button>
      </div>
    </Card>
  );
}

function SidePanel({
  conversation,
  contacts,
  onLinked,
}: {
  conversation: ConversationWithJoins;
  contacts: ContactWithJoins[];
  onLinked: () => void;
}) {
  const { t } = useLanguage();
  const [owners, setOwners] = useState<UserWithRole[]>([]);
  const [ownersLoaded, setOwnersLoaded] = useState(false);
  const [assigneeId, setAssigneeId] = useState(conversation.assignedUserId ?? "");
  const [assigneePending, setAssigneePending] = useState(false);

  const [contactId, setContactId] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | undefined>();

  const sameCompanyContacts = contacts.filter((c) => c.companyId === conversation.companyId);

  async function loadOwners() {
    if (ownersLoaded) return;
    const result = await getAssignableUsersAction(conversation.companyId);
    setOwners(result.users);
    setOwnersLoaded(true);
  }

  async function handleAssigneeChange(next: string) {
    setAssigneePending(true);
    await updateConversationAssigneeAction(conversation.id, next);
    setAssigneePending(false);
    setAssigneeId(next);
  }

  async function handleLink() {
    if (!contactId) return;
    setLinking(true);
    setLinkError(undefined);
    const result = await linkContactAction(conversation.id, contactId);
    setLinking(false);
    if (result.error) {
      setLinkError(result.error);
      return;
    }
    onLinked();
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <Avatar name={conversation.contactName ?? conversation.subject ?? "?"} size={44} />
        <div>
          <p className="text-[14.5px] font-semibold text-text-primary">
            {conversation.contactName ?? t("Unknown sender", "Remitente desconocido")}
          </p>
          <p className="text-[12.5px] text-text-secondary">{conversation.companyName}</p>
        </div>
      </div>

      {!conversation.contactId && (
        <div className="flex flex-col gap-2 rounded-xl border border-border p-3.5">
          <label className="text-[11px] font-semibold tracking-wide text-text-secondary">
            {t("LINK TO CONTACT", "ASOCIAR A CONTACTO")}
          </label>
          <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">{t("Select a contact...", "Selecciona un contacto...")}</option>
            {sameCompanyContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {linkError && <p className="text-[12.5px] text-danger">{linkError}</p>}
          <Button disabled={!contactId || linking} onClick={handleLink} className="w-full">
            {linking ? t("Linking...", "Asociando...") : t("Link", "Asociar")}
          </Button>
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
          {t("ASSIGNED TO", "ASIGNADO A")}
        </label>
        <div onFocus={loadOwners} onClick={loadOwners}>
          <Select value={assigneeId} disabled={assigneePending} onChange={(e) => handleAssigneeChange(e.target.value)}>
            <option value="">{t("Unassigned", "Sin asignar")}</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.fullName}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </Card>
  );
}
