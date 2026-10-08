"use client";

import { useEffect, useState } from "react";
import { Bold, Italic, Link2, Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SearchInput, Select, Textarea, Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/PageHeader";
import { useLanguage } from "@/context/LanguageContext";
import { useCompany, ALL_COMPANIES } from "@/context/CompanyContext";
import { useCurrentUserId } from "@/context/CurrentUserContext";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { loadDraft, saveDraft, clearDraft } from "@/lib/drafts";
import { isValidEmailFormat } from "@/lib/email";
import type { ContactWithJoins } from "@/server/repositories/contacts";
import type { Conversation } from "@/server/repositories/conversations";
import type { Message } from "@/server/repositories/messages";
import type { EmailSenderStatus } from "@/server/services/email";
import { getContactEmailDetailAction, sendEmailAction } from "./actions";

type EmailDraft = { subject: string; body: string };

export function CorreoClient({
  queue,
  initialSelectedId,
  initialConversation,
  initialMessages,
  senderStatus,
}: {
  queue: ContactWithJoins[];
  initialSelectedId: string | null;
  initialConversation: Conversation | null;
  initialMessages: Message[];
  senderStatus: EmailSenderStatus;
}) {
  const { t } = useLanguage();
  const { activeCompany, setActiveCompany } = useCompany();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [conversation, setConversation] = useState<Conversation | null>(initialConversation);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
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
  // of another, unrelated contact's conversation.
  const selected = searchedQueue.find((c) => c.id === selectedId);

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
        actions={
          <SearchInput
            placeholder={t("Search client, phone or email...", "Buscar cliente, teléfono o correo...")}
            className="max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
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
            <Badge tone="green">{searchedQueue.length}</Badge>
          </div>
          <div className="flex max-h-[560px] flex-col gap-1 overflow-y-auto">
            {searchedQueue.map((c) => (
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
            {searchedQueue.length === 0 && (
              <p className="py-6 text-center text-[13px] text-text-tertiary">
                {filteredQueue.length === 0
                  ? t("No contacts with an email address yet.", "Aún no hay contactos con correo.")
                  : t("No contacts match your search.", "Ningún contacto coincide con tu búsqueda.")}
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
            senderStatus={senderStatus}
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

const SENDER_STATUS_LABEL: Record<EmailSenderStatus["status"], { en: string; es: string; dot: string }> = {
  NOT_CONFIGURED: { en: "Not configured", es: "No configurado", dot: "bg-text-tertiary" },
  NOT_VERIFIED: { en: "Not verified", es: "No verificado", dot: "bg-warning" },
};

function EmailPanel({
  contact,
  conversation,
  messages,
  loadingDetail,
  onSent,
  senderStatus,
}: {
  contact: ContactWithJoins;
  conversation: Conversation | null;
  messages: Message[];
  loadingDetail: boolean;
  onSent: () => void;
  senderStatus: EmailSenderStatus;
}) {
  const { t, language } = useLanguage();
  const userId = useCurrentUserId();
  // Restored once per contact (this component remounts on every contact
  // switch via its `key={selected.id}` in CorreoClient — see below), never
  // copied from a different contact's draft: the lookup is keyed by this
  // exact contact.id/companyId, nothing else.
  const draft = loadDraft<EmailDraft>("email", userId, contact.companyId, contact.id);
  const [subject, setSubject] = useState(draft?.subject ?? conversation?.subject ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [draftWarning, setDraftWarning] = useState<string | undefined>();

  const recipientValid = !!contact.email && isValidEmailFormat(contact.email);
  const subjectValid = subject.trim().length > 0;
  const bodyValid = body.trim().length > 0;
  const emailAvailable = senderStatus.status !== "NOT_CONFIGURED";
  const canSend = emailAvailable && recipientValid && subjectValid && bodyValid;
  const validationMessage = !emailAvailable
    ? undefined // the "not configured" banner below already explains this
    : !recipientValid
      ? t("This contact doesn't have a valid email address.", "Este contacto no tiene una dirección de correo válida.")
      : !subjectValid
        ? t("Subject is required.", "El asunto es obligatorio.")
        : !bodyValid
          ? t("Message body can't be empty.", "El cuerpo del mensaje no puede estar vacío.")
          : undefined;

  // Keeps the draft in sync with every keystroke. Because this component is
  // remounted (not just re-rendered) whenever the selected contact changes,
  // whatever was last typed is already persisted well before the unmount —
  // "save before switching contacts" falls out of this for free, and it's
  // also what makes the draft survive a page refresh.
  useEffect(() => {
    const hasContent = subject.trim().length > 0 || body.trim().length > 0;
    if (!hasContent) {
      clearDraft("email", userId, contact.companyId, contact.id);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs a warning banner to an external system (localStorage write outcome), not a reactive cascade
      setDraftWarning(undefined);
      return;
    }
    const ok = saveDraft("email", userId, contact.companyId, contact.id, { subject, body });
    setDraftWarning(
      ok
        ? undefined
        : t(
            "Your draft couldn't be saved locally — copy your text before switching contacts.",
            "No se pudo guardar tu borrador localmente: copia el texto antes de cambiar de contacto."
          )
    );
  }, [subject, body, userId, contact.companyId, contact.id, t]);

  async function handleSend() {
    if (!canSend || sending) return;
    setSending(true);
    setError(undefined);
    const result = await sendEmailAction({ contactId: contact.id, subject, body });
    setSending(false);
    if (result.error) {
      // Send failed — keep the draft exactly as-is so the user can retry.
      setError(result.error);
      return;
    }
    clearDraft("email", userId, contact.companyId, contact.id);
    setBody("");
    onSent();
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-[18px] font-semibold text-text-primary">{contact.name}</h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          {t("To:", "Para:")} {contact.email || t("— (no email on file)", "— (sin correo registrado)")}
        </p>
        <p className="text-[13px] text-text-secondary">
          {t("From:", "De:")} {senderStatus.fromAddress ?? t("Not configured", "No configurado")}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-[12px] text-text-tertiary">
          <span className={cn("h-1.5 w-1.5 rounded-full", SENDER_STATUS_LABEL[senderStatus.status].dot)} aria-hidden />
          {language === "es" ? SENDER_STATUS_LABEL[senderStatus.status].es : SENDER_STATUS_LABEL[senderStatus.status].en}
        </p>
        {!emailAvailable && (
          <p className="mt-2 rounded-lg bg-surface-muted px-3 py-2 text-[12.5px] text-text-secondary">
            {t(
              "Email sending isn't available yet — no provider is configured. Contact an administrator.",
              "El envío de correos aún no está disponible: no hay un proveedor configurado. Contacta a un administrador."
            )}
          </p>
        )}
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
        {draftWarning && <p className="text-[12px] text-warning-700">{draftWarning}</p>}
        {error ? (
          <p className="text-[13px] text-danger">{error}</p>
        ) : (
          validationMessage && <p className="text-[12.5px] text-text-tertiary">{validationMessage}</p>
        )}
        <Button className="w-fit self-end" disabled={!canSend || sending} onClick={handleSend}>
          <Send className="h-4 w-4" /> {sending ? t("Sending...", "Enviando...") : t("Send reply", "Enviar respuesta")}
        </Button>
      </div>
    </Card>
  );
}
