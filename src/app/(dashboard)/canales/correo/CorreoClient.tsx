"use client";

import { useState } from "react";
import { Bold, Italic, Link2, Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SearchInput, Select, Textarea, Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/PageHeader";
import { useLanguage } from "@/context/LanguageContext";
import { useCompany, ALL_COMPANIES } from "@/context/CompanyContext";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ContactWithJoins } from "@/server/repositories/contacts";
import type { Conversation } from "@/server/repositories/conversations";
import type { Message } from "@/server/repositories/messages";
import { getContactEmailDetailAction, sendEmailAction } from "./actions";

export function CorreoClient({
  queue,
  initialSelectedId,
  initialConversation,
  initialMessages,
}: {
  queue: ContactWithJoins[];
  initialSelectedId: string | null;
  initialConversation: Conversation | null;
  initialMessages: Message[];
}) {
  const { t } = useLanguage();
  const { activeCompany, setActiveCompany } = useCompany();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [conversation, setConversation] = useState<Conversation | null>(initialConversation);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const filteredQueue = queue.filter((c) => activeCompany === ALL_COMPANIES || c.companyName === activeCompany);
  // Looked up from the company-scoped queue (not raw `queue`): a contact
  // selected before switching companies must stop showing once it's out of
  // scope, falling back to the empty state instead of another company's data.
  const selected = filteredQueue.find((c) => c.id === selectedId);

  async function selectContact(id: string) {
    setSelectedId(id);
    setLoadingDetail(true);
    const result = await getContactEmailDetailAction(id);
    setConversation(result.conversation);
    setMessages(result.messages);
    setLoadingDetail(false);
  }

  async function refreshDetail() {
    if (!selectedId) return;
    const result = await getContactEmailDetailAction(selectedId);
    setConversation(result.conversation);
    setMessages(result.messages);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Email Inbox", "Bandeja de Correo")}
        subtitle={t("Email conversations and templates", "Conversaciones por correo y plantillas")}
        actions={<SearchInput placeholder={t("Search client, phone or email...", "Buscar cliente, teléfono o correo...")} className="max-w-sm" />}
      />

      <div className="w-[220px]">
        <Select value={activeCompany} onChange={(e) => setActiveCompany(e.target.value)}>
          <option value={ALL_COMPANIES}>{t("All companies", "Todas las empresas")}</option>
          {[...new Set(queue.map((c) => c.companyName))].map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        <Card className="flex flex-col gap-1 p-5">
          <div className="mb-2 flex items-center justify-between">
            <CardTitle>{t("Contacts", "Contactos")}</CardTitle>
            <Badge tone="green">{filteredQueue.length}</Badge>
          </div>
          <div className="flex max-h-[560px] flex-col gap-1 overflow-y-auto">
            {filteredQueue.map((c) => (
              <button
                key={c.id}
                onClick={() => selectContact(c.id)}
                className={cn(
                  "rounded-xl px-3.5 py-3 text-left transition-colors",
                  selectedId === c.id ? "bg-brand-50" : "hover:bg-surface-muted"
                )}
              >
                <p className="text-[14px] font-semibold text-text-primary">{c.name}</p>
                <p className="mt-0.5 truncate text-[12.5px] text-text-secondary">{c.email}</p>
              </button>
            ))}
            {filteredQueue.length === 0 && (
              <p className="py-6 text-center text-[13px] text-text-tertiary">
                {t("No contacts with an email address yet.", "Aún no hay contactos con correo.")}
              </p>
            )}
          </div>
        </Card>

        {selected ? (
          <EmailPanel
            key={selected.id}
            contact={selected}
            conversation={conversation}
            messages={messages}
            loadingDetail={loadingDetail}
            onSent={refreshDetail}
          />
        ) : (
          <Card className="flex items-center justify-center p-6 text-[13.5px] text-text-tertiary">
            {t("Select a contact to view or start an email thread.", "Selecciona un contacto para ver o iniciar un correo.")}
          </Card>
        )}
      </div>
    </div>
  );
}

function EmailPanel({
  contact,
  conversation,
  messages,
  loadingDetail,
  onSent,
}: {
  contact: ContactWithJoins;
  conversation: Conversation | null;
  messages: Message[];
  loadingDetail: boolean;
  onSent: () => void;
}) {
  const { t, language } = useLanguage();
  const [subject, setSubject] = useState(conversation?.subject ?? "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSend() {
    setSending(true);
    setError(undefined);
    const result = await sendEmailAction({ contactId: contact.id, subject, body });
    setSending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setBody("");
    onSent();
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-[18px] font-semibold text-text-primary">{contact.name}</h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          {t("To:", "Para:")} {contact.email}
        </p>
      </div>

      <div className="flex max-h-[320px] flex-col gap-3 overflow-y-auto">
        {loadingDetail ? (
          <p className="py-6 text-center text-[13.5px] text-text-tertiary">{t("Loading...", "Cargando...")}</p>
        ) : messages.length === 0 ? (
          <p className="rounded-xl bg-surface-muted p-4 text-center text-[13.5px] text-text-tertiary">
            {t("No emails yet. Send the first one below.", "Aún no hay correos. Envía el primero abajo.")}
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn("rounded-xl p-4 text-[14px] leading-6", m.direction === "OUTBOUND" ? "bg-brand-50" : "bg-surface-muted")}>
              <p className="mb-1 text-[12px] font-medium text-text-secondary">
                {m.senderLabel ?? (m.direction === "OUTBOUND" ? t("You", "Tú") : contact.name)} · {formatDateTime(m.sentAt, language)}
              </p>
              <p className="whitespace-pre-line text-text-primary">{m.body}</p>
            </div>
          ))
        )}
      </div>

      <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
        {!conversation && (
          <Input
            placeholder={t("Subject", "Asunto")}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        )}
        <div className="flex items-center gap-3 text-text-secondary">
          <Bold className="h-4 w-4 cursor-pointer hover:text-text-primary" />
          <Italic className="h-4 w-4 cursor-pointer hover:text-text-primary" />
          <Link2 className="h-4 w-4 cursor-pointer hover:text-text-primary" />
          <Paperclip className="h-4 w-4 cursor-pointer hover:text-text-primary" />
        </div>
        <Textarea
          rows={3}
          placeholder={t("Write a reply...", "Escribe una respuesta...")}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <Button className="w-fit self-end" disabled={sending} onClick={handleSend}>
          <Send className="h-4 w-4" /> {sending ? t("Sending...", "Enviando...") : t("Send reply", "Enviar respuesta")}
        </Button>
      </div>
    </Card>
  );
}
