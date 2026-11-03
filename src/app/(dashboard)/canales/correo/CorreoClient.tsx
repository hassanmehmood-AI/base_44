"use client";

import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Link2, Paperclip, Send, Inbox } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SearchInput, Select, Textarea, Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/PageHeader";
import { useLanguage } from "@/context/LanguageContext";
import { useCompany, ALL_COMPANIES } from "@/context/CompanyContext";
import { useCurrentUserId } from "@/context/CurrentUserContext";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { loadDraft, saveDraft, clearDraft } from "@/lib/drafts";
import { isValidEmailFormat } from "@/lib/email";
import { contactSecondaryLine, disambiguationSuffixes } from "@/lib/contactIdentity";
import type { ContactWithJoins } from "@/server/repositories/contacts";
import type { Conversation, ConversationWithJoins } from "@/server/repositories/conversations";
import type { Message } from "@/server/repositories/messages";
import type { EmailSenderStatus } from "@/server/services/email";
import {
  getContactEmailDetailAction,
  sendEmailAction,
  listUnassignedEmailConversationsAction,
  getUnassignedConversationDetailAction,
  linkEmailConversationToContactAction,
  createContactAndLinkEmailConversationAction,
} from "./actions";
import { useEmailRealtime } from "./useEmailRealtime";

type EmailDraft = { subject: string; body: string };
type Tab = "contacts" | "unassigned";

export function CorreoClient({
  queue,
  allContacts,
  initialSelectedId,
  initialConversation,
  initialMessages,
  senderStatus,
  initialUnassignedConversations,
}: {
  queue: ContactWithJoins[];
  /** Unfiltered — includes contacts with no email on file too, since an
   * Unassigned sender can still be linked to one of those (their email is
   * simply missing yet, same as it is for any other contact). Used only by
   * the "link to existing contact" dropdown, never the main Contacts list
   * (which stays email-only, unchanged). */
  allContacts: ContactWithJoins[];
  initialSelectedId: string | null;
  initialConversation: Conversation | null;
  initialMessages: Message[];
  /** Resolved for whichever contact is initially selected (see page.tsx's
   * getConversationForContact call) — per-conversation, not a page-wide
   * constant, since each contact's conversation may or may not have its own
   * connected Gmail mailbox (conversations.companyEmailAccountId). Updated
   * alongside conversation/messages on every select/refresh below. */
  senderStatus: EmailSenderStatus;
  initialUnassignedConversations: ConversationWithJoins[];
}) {
  const { t } = useLanguage();
  const { activeCompany, setActiveCompany } = useCompany();
  const [tab, setTab] = useState<Tab>("contacts");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [conversation, setConversation] = useState<Conversation | null>(initialConversation);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [emailSenderStatus, setEmailSenderStatus] = useState<EmailSenderStatus>(senderStatus);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState("");

  const [unassigned, setUnassigned] = useState<ConversationWithJoins[]>(initialUnassignedConversations);
  const [selectedUnassignedId, setSelectedUnassignedId] = useState<string | null>(null);
  const [unassignedDetail, setUnassignedDetail] = useState<{ conversation: Conversation; messages: Message[] } | null>(null);
  const [loadingUnassignedDetail, setLoadingUnassignedDetail] = useState(false);

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

  // Only kicks in for contacts that are still indistinguishable after name +
  // company + business + email are all shown (see the row below) — the
  // common case gets no suffix at all.
  const dupeSuffixes = disambiguationSuffixes(searchedQueue, (c) => [c.name, c.companyName, c.businessName, c.email]);

  // Looked up from the searched/company-scoped queue (not raw `queue`): a
  // contact selected before switching companies or searching must stop
  // showing once it's filtered out, falling back to the empty state instead
  // of another, unrelated contact's conversation.
  const selected = searchedQueue.find((c) => c.id === selectedId);

  const filteredUnassigned = unassigned.filter((c) => activeCompany === ALL_COMPANIES || c.companyName === activeCompany);
  const selectedUnassigned = filteredUnassigned.find((c) => c.id === selectedUnassignedId);

  async function selectContact(id: string) {
    setSelectedId(id);
    setLoadingDetail(true);
    const result = await getContactEmailDetailAction(id);
    setConversation(result.conversation);
    setMessages(result.messages);
    setEmailSenderStatus(result.senderStatus);
    setLoadingDetail(false);
  }

  async function refreshDetail() {
    if (!selectedId) return;
    const result = await getContactEmailDetailAction(selectedId);
    setConversation(result.conversation);
    setMessages(result.messages);
    setEmailSenderStatus(result.senderStatus);
  }

  async function refreshUnassignedList() {
    const result = await listUnassignedEmailConversationsAction();
    setUnassigned(result);
  }

  async function selectUnassigned(id: string) {
    setSelectedUnassignedId(id);
    setLoadingUnassignedDetail(true);
    const result = await getUnassignedConversationDetailAction(id);
    setUnassignedDetail(result);
    setLoadingUnassignedDetail(false);
  }

  async function refreshUnassignedDetail() {
    if (!selectedUnassignedId) return;
    const result = await getUnassignedConversationDetailAction(selectedUnassignedId);
    setUnassignedDetail(result);
  }

  async function handleLinked() {
    setSelectedUnassignedId(null);
    setUnassignedDetail(null);
    await refreshUnassignedList();
  }

  // Refs so the realtime callback below (registered once, like
  // useWhatsappRealtime's own call site) always sees the latest selection
  // rather than whatever was selected at the time the hook first ran.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const selectedUnassignedIdRef = useRef(selectedUnassignedId);
  selectedUnassignedIdRef.current = selectedUnassignedId;
  const conversationIdRef = useRef(conversation?.id ?? null);
  conversationIdRef.current = conversation?.id ?? null;

  // Same channel-agnostic realtime pointer WhatsApp/Social Media already
  // use — see useEmailRealtime.ts's doc comment for why no backend change
  // was needed for this to also cover Gmail-synced inbound messages. Always
  // refreshes the Unassigned list (a brand-new unassigned thread has no
  // currently-open conversation to match against) and refreshes whichever
  // detail panel is actually open only when its own conversation changed.
  useEmailRealtime((event) => {
    refreshUnassignedList().catch((e) => console.error("[realtime] failed to refresh unassigned emails:", e));
    if ("reconnected" in event) {
      if (selectedIdRef.current) refreshDetail().catch((e) => console.error("[realtime] failed to refresh email detail:", e));
      if (selectedUnassignedIdRef.current) refreshUnassignedDetail().catch((e) => console.error("[realtime] failed to refresh unassigned email detail:", e));
      return;
    }
    if (conversationIdRef.current && event.conversationId === conversationIdRef.current) {
      refreshDetail().catch((e) => console.error("[realtime] failed to refresh email detail:", e));
    }
    if (selectedUnassignedIdRef.current && event.conversationId === selectedUnassignedIdRef.current) {
      refreshUnassignedDetail().catch((e) => console.error("[realtime] failed to refresh unassigned email detail:", e));
    }
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Email Inbox", "Bandeja de Correo")}
        subtitle={t("Email conversations and templates", "Conversaciones por correo y plantillas")}
        actions={
          tab === "contacts" ? (
            <SearchInput
              placeholder={t("Search client, phone or email...", "Buscar cliente, teléfono o correo...")}
              className="max-w-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg bg-text-primary p-1">
          <button
            onClick={() => setTab("contacts")}
            className={cn(
              "rounded-md px-4 py-1.5 text-[13.5px] font-medium transition-colors",
              tab === "contacts" ? "bg-white text-text-primary" : "text-white/70 hover:text-white"
            )}
          >
            {t("Contacts", "Contactos")}
          </button>
          <button
            onClick={() => setTab("unassigned")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-[13.5px] font-medium transition-colors",
              tab === "unassigned" ? "bg-white text-text-primary" : "text-white/70 hover:text-white"
            )}
          >
            <Inbox className="h-3.5 w-3.5" />
            {t("Unassigned", "Sin asignar")}
            {filteredUnassigned.length > 0 && <Badge tone="amber">{filteredUnassigned.length}</Badge>}
          </button>
        </div>

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
      </div>

      {tab === "contacts" ? (
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
                  <p className="truncate text-[14px] font-semibold text-text-primary">
                    {c.name}
                    {dupeSuffixes.has(c.id) && <span className="text-text-tertiary"> {dupeSuffixes.get(c.id)}</span>}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-text-secondary">
                    {contactSecondaryLine(c.companyName, c.businessName)}
                  </p>
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
              senderStatus={emailSenderStatus}
            />
          ) : (
            <Card className="flex items-center justify-center p-6 text-[13.5px] text-text-tertiary">
              {t("Select a contact to view or start an email thread.", "Selecciona un contacto para ver o iniciar un correo.")}
            </Card>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
          <Card className="flex flex-col gap-1 p-5">
            <div className="mb-2 flex items-center justify-between">
              <CardTitle>{t("Unassigned emails", "Correos sin asignar")}</CardTitle>
              <Badge tone="amber">{filteredUnassigned.length}</Badge>
            </div>
            <div className="flex max-h-[560px] flex-col gap-1 overflow-y-auto">
              {filteredUnassigned.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectUnassigned(c.id)}
                  className={cn(
                    "rounded-xl px-3.5 py-3 text-left transition-colors",
                    selectedUnassignedId === c.id ? "bg-brand-50" : "hover:bg-surface-muted"
                  )}
                >
                  <p className="truncate text-[14px] font-semibold text-text-primary">
                    {c.subject ?? t("(no subject)", "(sin asunto)")}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-text-secondary">{c.companyName}</p>
                  {c.lastMessageAt && (
                    <p className="mt-0.5 truncate text-[12px] text-text-tertiary">{formatRelativeTime(c.lastMessageAt)}</p>
                  )}
                </button>
              ))}
              {filteredUnassigned.length === 0 && (
                <p className="py-6 text-center text-[13px] text-text-tertiary">
                  {t(
                    "No unassigned emails — every inbound message matched an existing contact.",
                    "No hay correos sin asignar: todos los mensajes entrantes coincidieron con un contacto existente."
                  )}
                </p>
              )}
            </div>
          </Card>

          {selectedUnassigned && unassignedDetail ? (
            <UnassignedEmailPanel
              key={selectedUnassigned.id}
              conversation={selectedUnassigned}
              messages={unassignedDetail.messages}
              loadingDetail={loadingUnassignedDetail}
              sameCompanyContacts={allContacts.filter((c) => c.companyId === selectedUnassigned.companyId)}
              onLinked={handleLinked}
            />
          ) : (
            <Card className="flex items-center justify-center p-6 text-[13.5px] text-text-tertiary">
              {t("Select an unassigned email to review and link it to a contact.", "Selecciona un correo sin asignar para revisarlo y asociarlo a un contacto.")}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

const SENDER_STATUS_LABEL: Record<EmailSenderStatus["status"], { en: string; es: string; dot: string }> = {
  NOT_CONFIGURED: { en: "Not configured", es: "No configurado", dot: "bg-text-tertiary" },
  NOT_VERIFIED: { en: "Not verified", es: "No verificado", dot: "bg-warning" },
  CONNECTED_GMAIL: { en: "Connected (Gmail)", es: "Conectado (Gmail)", dot: "bg-brand" },
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
  const [subject, setSubject] = useState(conversation?.subject ?? "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [draftWarning, setDraftWarning] = useState<string | undefined>();
  const [draftLoaded, setDraftLoaded] = useState(false);

  // Restored once per contact (this component remounts on every contact
  // switch via its `key={selected.id}` in CorreoClient — see below), never
  // copied from a different contact's draft: the lookup is keyed by this
  // exact contact.id/companyId, nothing else. Deliberately loaded in an
  // effect rather than the useState initializer above: localStorage
  // doesn't exist during SSR, so reading it synchronously during render
  // made the server's first render (always "no draft") disagree with the
  // client's very first render (the real draft, already in localStorage)
  // — a genuine hydration mismatch that made React discard and regenerate
  // this subtree, which is what made Send reply (and every other control
  // in this panel) appear unresponsive right after a fresh page load.
  // Loading it a tick later, after the SSR-identical first paint, avoids
  // the mismatch entirely while still restoring the draft before the user
  // can realistically have typed anything.
  useEffect(() => {
    const draft = loadDraft<EmailDraft>("email", userId, contact.companyId, contact.id);
    if (draft?.subject) setSubject(draft.subject);
    if (draft?.body) setBody(draft.body);
    setDraftLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally once per mount (this component remounts per contact via key={selected.id})
  }, []);

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
  // also what makes the draft survive a page refresh. Guarded on
  // draftLoaded so this can never fire with the pre-load empty state and
  // clear out a draft the load effect above hasn't had a chance to apply
  // yet — this effect's first real run is always AFTER the load effect's.
  useEffect(() => {
    if (!draftLoaded) return;
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
  }, [subject, body, userId, contact.companyId, contact.id, t, draftLoaded]);

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
          {t("Company:", "Empresa:")} {contact.companyName}
        </p>
        {contact.businessName && (
          <p className="text-[13px] text-text-secondary">
            {t("Business:", "Negocio:")} {contact.businessName}
          </p>
        )}
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

/** The Unassigned Email Inbox's review/link panel — read-only thread (no
 * reply box: there's no contact yet to send as, mirroring how Social
 * Media's own equivalent panel behaves before a conversation is linked)
 * plus the two manual resolution actions approved for this feature: link
 * to an existing contact, or create a brand-new one. Deliberately never
 * does either automatically. */
function UnassignedEmailPanel({
  conversation,
  messages,
  loadingDetail,
  sameCompanyContacts,
  onLinked,
}: {
  conversation: ConversationWithJoins;
  messages: Message[];
  loadingDetail: boolean;
  sameCompanyContacts: ContactWithJoins[];
  onLinked: () => void;
}) {
  const { t, language } = useLanguage();
  const [contactId, setContactId] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | undefined>();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();

  async function handleLink() {
    if (!contactId) return;
    setLinking(true);
    setLinkError(undefined);
    const result = await linkEmailConversationToContactAction(conversation.id, contactId);
    setLinking(false);
    if (result.error) {
      setLinkError(result.error);
      return;
    }
    onLinked();
  }

  async function handleCreateAndLink() {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(undefined);
    const result = await createContactAndLinkEmailConversationAction(conversation.id, { name: newName.trim() });
    setCreating(false);
    if (result.error) {
      setCreateError(result.error);
      return;
    }
    onLinked();
  }

  return (
    <Card className="flex max-h-[calc(100vh-280px)] min-h-[520px] flex-col gap-4 overflow-y-auto p-5">
      <div>
        <p className="text-[14.5px] font-semibold text-text-primary">
          {conversation.subject ?? t("(no subject)", "(sin asunto)")}
        </p>
        <p className="text-[12.5px] text-text-secondary">{conversation.companyName}</p>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-border p-3.5">
        <label className="text-[11px] font-semibold tracking-wide text-text-secondary">
          {t("LINK TO EXISTING CONTACT", "ASOCIAR A CONTACTO EXISTENTE")}
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

      <div className="flex flex-col gap-2 rounded-xl border border-border p-3.5">
        <label className="text-[11px] font-semibold tracking-wide text-text-secondary">
          {t("OR CREATE A NEW CONTACT", "O CREAR UN CONTACTO NUEVO")}
        </label>
        <Input placeholder={t("Full name", "Nombre completo")} value={newName} onChange={(e) => setNewName(e.target.value)} />
        {createError && <p className="text-[12.5px] text-danger">{createError}</p>}
        <Button variant="outline" disabled={!newName.trim() || creating} onClick={handleCreateAndLink} className="w-full">
          {creating ? t("Creating...", "Creando...") : t("Create & link", "Crear y asociar")}
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto border-t border-border pt-4">
        {loadingDetail ? (
          <p className="py-6 text-center text-[13.5px] text-text-tertiary">{t("Loading...", "Cargando...")}</p>
        ) : messages.length === 0 ? (
          <p className="rounded-xl bg-surface-muted p-4 text-center text-[13.5px] text-text-tertiary">
            {t("No messages yet.", "Aún no hay mensajes.")}
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn("rounded-xl p-4 text-[14px] leading-6", m.direction === "OUTBOUND" ? "bg-brand-50" : "bg-surface-muted")}>
              <p className="mb-1 text-[12px] font-medium text-text-secondary">
                {m.senderLabel ?? (m.direction === "OUTBOUND" ? t("You", "Tú") : t("Unknown sender", "Remitente desconocido"))} ·{" "}
                {formatDateTime(m.sentAt, language)}
              </p>
              <p className="whitespace-pre-line text-text-primary">{m.body}</p>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
