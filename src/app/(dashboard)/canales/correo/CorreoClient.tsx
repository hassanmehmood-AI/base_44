"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TiptapUnderline from "@tiptap/extension-underline";
import TiptapLink from "@tiptap/extension-link";
import TiptapPlaceholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link2,
  List,
  ListOrdered,
  Paperclip,
  Send,
  Inbox,
  Mail,
  MailCheck,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  File as FileIcon,
  X,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SearchInput, Select, Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/PageHeader";
import { useLanguage } from "@/context/LanguageContext";
import { useCompany, ALL_COMPANIES } from "@/context/CompanyContext";
import { useCurrentUserId } from "@/context/CurrentUserContext";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { loadDraft, saveDraft, clearDraft } from "@/lib/drafts";
import { isValidEmailFormat } from "@/lib/email";
import { sanitizeEmailHtml } from "@/lib/emailHtml";
import { validateAttachment, formatFileSize, ALLOWED_ATTACHMENT_TYPES } from "@/lib/emailAttachments";
import type { StoredEmailAttachment } from "@/lib/emailAttachments";
import { contactSecondaryLine, disambiguationSuffixes } from "@/lib/contactIdentity";
import type { ContactWithJoins } from "@/server/repositories/contacts";
import type { Conversation, ConversationWithJoins } from "@/server/repositories/conversations";
import type { Message } from "@/server/repositories/messages";
import type { EmailSenderStatus, EmailProviderByContact } from "@/server/services/email";
import {
  getContactEmailDetailAction,
  sendEmailAction,
  listUnassignedEmailConversationsAction,
  getUnassignedConversationDetailAction,
  linkEmailConversationToContactAction,
  createContactAndLinkEmailConversationAction,
  getAvailableSenderAccountsAction,
  getEmailProvidersByContactAction,
} from "./actions";
import type { AvailableSenderAccount } from "@/server/services/email";
import { useEmailRealtime } from "./useEmailRealtime";

/** New shape: bodyHtml, not body — see EmailPanel's draft-loading effect
 * for how an OLD {subject, body} draft (plain text, from before formatted
 * composing existed) is still read and upgraded losslessly rather than
 * discarded. */
type EmailDraft = { subject: string; bodyHtml: string };
/** The pre-rich-text draft shape — only ever read, never written again,
 * kept solely so a draft saved before this change still loads correctly. */
type LegacyEmailDraft = { subject?: string; body?: string };
type Tab = "contacts" | "unassigned";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Upgrades a legacy plain-text draft into HTML Tiptap can load, without
 * losing any of the user's previously-saved text. Never used for anything
 * else — new drafts are always saved as real HTML from the editor itself. */
function legacyDraftToHtml(body: string): string {
  const paragraphs = body.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`);
  return paragraphs.join("");
}

/** Plain-text emails carry their quoted reply history inline (Gmail's own
 * "On <date>, <sender> wrote:" header followed by "> "-prefixed lines, or
 * Outlook's "-----Original Message-----"), unlike HTML emails where Gmail
 * puts that history in a separate, visually-collapsed <div class="gmail_
 * quote">. Without this split, a plain-text reply renders as one long wall
 * of quote-marked text instead of just the new reply — purely a display
 * concern, the full original `body` is never altered or re-stored. */
function splitQuotedText(text: string): { main: string; quoted: string | null } {
  const lines = text.split("\n");
  const headerRegex = /^(on .{0,300}wrote:|-{2,}\s*(original|forwarded) message\s*-{2,})\s*$/i;
  let quoteStart = lines.findIndex((line) => headerRegex.test(line.trim()));
  if (quoteStart === -1) {
    quoteStart = lines.findIndex((line) => line.trim().startsWith(">"));
  }
  if (quoteStart === -1) return { main: text, quoted: null };
  const main = lines.slice(0, quoteStart).join("\n").trimEnd();
  const quoted = lines.slice(quoteStart).join("\n").trim();
  // No real reply text above the quote (e.g. a bare forward) — nothing
  // meaningful to collapse, show the original body as-is.
  if (!main || !quoted) return { main: text, quoted: null };
  return { main, quoted };
}

/** Gmail-style "..." toggle for the collapsed quoted history — closed by
 * default so the thread reads as just the new replies, same as Gmail's
 * own inbox view. */
function QuotedTextToggle({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Hide quoted text" : "Show quoted text"}
        aria-expanded={open}
        className="inline-flex h-6 w-9 items-center justify-center rounded border border-border bg-background-secondary text-text-secondary hover:bg-background-tertiary"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 rotate-180" /> : "···"}
      </button>
      {open && (
        <p className="mt-2 whitespace-pre-line border-l-2 border-border pl-3 text-sm text-text-secondary">
          {text}
        </p>
      )}
    </div>
  );
}

/** Renders a stored message's body: sanitized HTML when present (stored
 * already-sanitized server-side — see gmailSync.ts/email.ts — and
 * re-sanitized here too, defense-in-depth, before dangerouslySetInnerHTML
 * ever touches it), else the existing plain-text rendering, with its
 * quoted reply history collapsed behind a toggle (see splitQuotedText). */
function EmailMessageBody({ body, metadata }: { body: string; metadata: unknown }) {
  const bodyHtml = (metadata as { bodyHtml?: string } | null)?.bodyHtml;
  if (bodyHtml) {
    const safe = sanitizeEmailHtml(bodyHtml);
    return (
      <div
        className={cn(
          "break-words text-text-primary",
          "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
          "[&_a]:text-brand [&_a]:underline",
          "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary",
          "[&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-1.5 [&_th]:border [&_th]:border-border [&_th]:p-1.5",
          "[&_h1]:text-[18px] [&_h1]:font-semibold [&_h2]:text-[16px] [&_h2]:font-semibold [&_h3]:text-[14px] [&_h3]:font-semibold"
        )}
        // eslint-disable-next-line react/no-danger -- sanitized twice (server at storage time, client here) via the same DOMPurify allow-list; see lib/emailHtml.ts
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    );
  }
  const { main, quoted } = splitQuotedText(body);
  return (
    <div>
      <p className="whitespace-pre-line text-text-primary">{main}</p>
      {quoted && <QuotedTextToggle text={quoted} />}
    </div>
  );
}

/** Color-coded generic mail glyph, never Google's actual Gmail logo — we
 * have no license to render that trademark, and a color-coded icon reads
 * just as clearly ("which mailbox") without that risk. Shared by the list
 * badges below and the composer's own "From" line so the same visual
 * language (red = Gmail, slate = Webmail) is used everywhere a provider is
 * identified. */
function ProviderIcon({ provider, className }: { provider: "GOOGLE_WORKSPACE" | "SMTP_IMAP"; className?: string }) {
  const Icon = provider === "GOOGLE_WORKSPACE" ? MailCheck : Mail;
  return <Icon className={cn(provider === "GOOGLE_WORKSPACE" ? "text-[#EA4335]" : "text-text-secondary", className)} aria-hidden />;
}

/** Small provider badge(s) for the Contacts/Unassigned row lists — renders
 * nothing when there's no EMAIL conversation yet (null/undefined/empty
 * array), same "no badge until there's something to show" rule as every
 * other optional indicator in this list. Accepts either a single provider
 * (the Unassigned tab — one conversation, one provider) or a list (the
 * Contacts tab — a contact can now have one conversation per connected
 * mailbox, so it needs one badge per distinct provider it actually has). */
function ProviderBadge({
  provider,
}: {
  provider: "GOOGLE_WORKSPACE" | "SMTP_IMAP" | ("GOOGLE_WORKSPACE" | "SMTP_IMAP")[] | null | undefined;
}) {
  const providers = provider == null ? [] : Array.isArray(provider) ? provider : [provider];
  if (providers.length === 0) return null;
  return (
    <>
      {providers.map((p) => (
        <Badge key={p} tone={p === "GOOGLE_WORKSPACE" ? "blue" : "gray"} className="shrink-0 gap-1">
          <ProviderIcon provider={p} className="h-3 w-3" />
          {p === "GOOGLE_WORKSPACE" ? "Gmail" : "Webmail"}
        </Badge>
      ))}
    </>
  );
}

const ATTACHMENT_ICON: Record<string, typeof FileIcon> = {
  "application/pdf": FileText,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": FileText,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": FileSpreadsheet,
  "image/jpeg": ImageIcon,
  "image/png": ImageIcon,
};

/** Attachments stored on a message (inbound or sent) — each one links to
 * api/email-attachments/[messageId]/[index], the authenticated serving
 * route (company access checked server-side on every request, same as
 * avatars) that's the only path to the actual bytes. Renders nothing when
 * a message has none, same as EmailMessageBody falling back silently when
 * there's no HTML. */
function EmailAttachmentList({ messageId, metadata }: { messageId: string; metadata: unknown }) {
  const attachments = (metadata as { attachments?: StoredEmailAttachment[] } | null)?.attachments;
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((attachment, index) => {
        const Icon = ATTACHMENT_ICON[attachment.mimeType] ?? FileIcon;
        return (
          <a
            key={index}
            href={`/api/email-attachments/${messageId}/${index}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[12px] text-text-primary hover:bg-surface-muted"
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
            <span className="max-w-[160px] truncate">{attachment.filename}</span>
            <span className="shrink-0 text-text-tertiary">{formatFileSize(attachment.size)}</span>
          </a>
        );
      })}
    </div>
  );
}

/** Minimal Gmail-style formatting toolbar bound to real Tiptap commands —
 * the icons themselves (and which ones exist) are unchanged from before;
 * only their functionality is new. */
function ComposerToolbar({ editor, onAttachClick }: { editor: Editor | null; onAttachClick: () => void }) {
  const { t } = useLanguage();
  if (!editor) return null;

  function setLink() {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt(t("Link URL", "URL del enlace"), previousUrl ?? "https://");
    if (url === null) return; // cancelled
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  const buttonClass = (active: boolean) =>
    cn("cursor-pointer hover:text-text-primary", active ? "text-brand" : "text-text-secondary");

  return (
    <div className="flex items-center gap-3">
      <Bold
        className={cn("h-4 w-4", buttonClass(editor.isActive("bold")))}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <Italic
        className={cn("h-4 w-4", buttonClass(editor.isActive("italic")))}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <UnderlineIcon
        className={cn("h-4 w-4", buttonClass(editor.isActive("underline")))}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      />
      <List
        className={cn("h-4 w-4", buttonClass(editor.isActive("bulletList")))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ListOrdered
        className={cn("h-4 w-4", buttonClass(editor.isActive("orderedList")))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <Link2 className={cn("h-4 w-4", buttonClass(editor.isActive("link")))} onClick={setLink} />
      <Paperclip className="h-4 w-4 cursor-pointer text-text-secondary hover:text-text-primary" onClick={onAttachClick} />
    </div>
  );
}

export function CorreoClient({
  queue,
  allContacts,
  initialSelectedId,
  initialConversations,
  initialConversation,
  initialMessages,
  senderStatus,
  initialUnassignedConversations,
  initialEmailProviders,
}: {
  queue: ContactWithJoins[];
  /** Unfiltered — includes contacts with no email on file too, since an
   * Unassigned sender can still be linked to one of those (their email is
   * simply missing yet, same as it is for any other contact). Used only by
   * the "link to existing contact" dropdown, never the main Contacts list
   * (which stays email-only, unchanged). */
  allContacts: ContactWithJoins[];
  initialSelectedId: string | null;
  /** ALL of the initially-selected contact's EMAIL conversations — a
   * contact can have more than one (one per connected mailbox that's
   * actually exchanged mail with them, see email.ts's
   * getConversationForContact). Powers the thread picker in EmailPanel;
   * empty when the contact has none yet. */
  initialConversations: ConversationWithJoins[];
  initialConversation: Conversation | null;
  initialMessages: Message[];
  /** Resolved for whichever contact is initially selected (see page.tsx's
   * getConversationForContact call) — per-conversation, not a page-wide
   * constant, since each contact's conversation may or may not have its own
   * connected Gmail mailbox (conversations.companyEmailAccountId). Updated
   * alongside conversation/messages on every select/refresh below. */
  senderStatus: EmailSenderStatus;
  initialUnassignedConversations: ConversationWithJoins[];
  /** contactId -> every mailbox provider that contact has an EMAIL
   * conversation on (a contact can now have more than one — see above) —
   * powers the Contacts tab's provider badges/filter. Unassigned rows need
   * no separate map: ConversationWithJoins already carries emailProvider
   * directly on each row. */
  initialEmailProviders: EmailProviderByContact;
}) {
  const { t } = useLanguage();
  const { activeCompany, setActiveCompany } = useCompany();
  const [tab, setTab] = useState<Tab>("contacts");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [conversations, setConversations] = useState<ConversationWithJoins[]>(initialConversations);
  const [conversation, setConversation] = useState<Conversation | null>(initialConversation);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [emailSenderStatus, setEmailSenderStatus] = useState<EmailSenderStatus>(senderStatus);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState("");
  // Unified-inbox filter — applies to both the Contacts and Unassigned
  // tabs, independent of the existing company selector.
  const [providerFilter, setProviderFilter] = useState<"ALL" | "GOOGLE_WORKSPACE" | "SMTP_IMAP">("ALL");
  const [emailProviders, setEmailProviders] = useState<EmailProviderByContact>(initialEmailProviders);

  const [unassigned, setUnassigned] = useState<ConversationWithJoins[]>(initialUnassignedConversations);
  const [selectedUnassignedId, setSelectedUnassignedId] = useState<string | null>(null);
  const [unassignedDetail, setUnassignedDetail] = useState<{ conversation: Conversation; messages: Message[] } | null>(null);
  const [loadingUnassignedDetail, setLoadingUnassignedDetail] = useState(false);

  const companyScopedQueue = queue.filter((c) => activeCompany === ALL_COMPANIES || c.companyName === activeCompany);
  const filteredQueue = companyScopedQueue.filter(
    (c) => providerFilter === "ALL" || (emailProviders[c.id] ?? []).includes(providerFilter)
  );

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

  const filteredUnassigned = unassigned.filter(
    (c) =>
      (activeCompany === ALL_COMPANIES || c.companyName === activeCompany) &&
      (providerFilter === "ALL" || c.emailProvider === providerFilter)
  );
  const selectedUnassigned = filteredUnassigned.find((c) => c.id === selectedUnassignedId);

  async function selectContact(id: string) {
    setSelectedId(id);
    setLoadingDetail(true);
    const result = await getContactEmailDetailAction(id);
    setConversations(result.conversations);
    setConversation(result.conversation);
    setMessages(result.messages);
    setEmailSenderStatus(result.senderStatus);
    setLoadingDetail(false);
  }

  // Preserves whichever thread is currently open (conversation?.id) rather
  // than letting a refresh silently default back to the most recent one —
  // a contact can now have more than one EMAIL conversation, and a realtime
  // nudge or post-send refresh must never switch you out of the thread
  // you're actively viewing/replying to.
  async function refreshDetail() {
    if (!selectedId) return;
    const result = await getContactEmailDetailAction(selectedId, conversation?.id);
    setConversations(result.conversations);
    setConversation(result.conversation);
    setMessages(result.messages);
    setEmailSenderStatus(result.senderStatus);
  }

  // Switches which of the contact's EMAIL conversations is being viewed —
  // used by EmailPanel's thread picker. Deliberately a full detail re-fetch
  // (not a local array lookup) so messages/senderStatus for the newly
  // selected thread are always loaded.
  async function selectConversationThread(conversationId: string) {
    if (!selectedId) return;
    setLoadingDetail(true);
    const result = await getContactEmailDetailAction(selectedId, conversationId);
    setConversations(result.conversations);
    setConversation(result.conversation);
    setMessages(result.messages);
    setEmailSenderStatus(result.senderStatus);
    setLoadingDetail(false);
  }

  async function refreshUnassignedList() {
    const result = await listUnassignedEmailConversationsAction();
    setUnassigned(result);
  }

  async function refreshEmailProviders() {
    const result = await getEmailProvidersByContactAction();
    setEmailProviders(result);
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
    refreshEmailProviders().catch((e) => console.error("[realtime] failed to refresh email providers:", e));
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

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border bg-white p-1">
            {(
              [
                { value: "ALL", en: "All", es: "Todos" },
                { value: "GOOGLE_WORKSPACE", en: "Gmail", es: "Gmail" },
                { value: "SMTP_IMAP", en: "Webmail", es: "Webmail" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setProviderFilter(opt.value)}
                className={cn(
                  "rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors",
                  providerFilter === opt.value ? "bg-brand-50 text-brand" : "text-text-secondary hover:text-text-primary"
                )}
              >
                {t(opt.en, opt.es)}
              </button>
            ))}
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
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[14px] font-semibold text-text-primary">
                      {c.name}
                      {dupeSuffixes.has(c.id) && <span className="text-text-tertiary"> {dupeSuffixes.get(c.id)}</span>}
                    </p>
                    <ProviderBadge provider={emailProviders[c.id]} />
                  </div>
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
              conversations={conversations}
              conversation={conversation}
              messages={messages}
              loadingDetail={loadingDetail}
              onSent={refreshDetail}
              onSelectThread={selectConversationThread}
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
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[14px] font-semibold text-text-primary">
                      {c.subject ?? t("(no subject)", "(sin asunto)")}
                    </p>
                    <ProviderBadge provider={c.emailProvider} />
                  </div>
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
  CONNECTED_SMTP: { en: "Connected (Webmail)", es: "Conectado (Webmail)", dot: "bg-brand" },
  CHOOSE_SENDER: { en: "Choose a sending mailbox below", es: "Elige un buzón de envío abajo", dot: "bg-warning" },
};

function EmailPanel({
  contact,
  conversations,
  conversation,
  messages,
  loadingDetail,
  onSent,
  onSelectThread,
  senderStatus,
}: {
  contact: ContactWithJoins;
  /** All of this contact's EMAIL conversations — one per connected mailbox
   * that's actually exchanged mail with them. Powers the thread picker
   * below, shown only when there's more than one. */
  conversations: ConversationWithJoins[];
  conversation: Conversation | null;
  messages: Message[];
  loadingDetail: boolean;
  onSent: () => void;
  onSelectThread: (conversationId: string) => void;
  senderStatus: EmailSenderStatus;
}) {
  const { t, language } = useLanguage();
  const userId = useCurrentUserId();
  const [subject, setSubject] = useState(conversation?.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [draftWarning, setDraftWarning] = useState<string | undefined>();
  const [draftLoaded, setDraftLoaded] = useState(false);
  // Deliberately NOT part of the localStorage draft: a browser File object
  // can't be serialized/restored across a page reload (its bytes only ever
  // live in memory for this one session) — attachments are lost on
  // refresh/contact-switch exactly like an in-progress Gmail compose
  // window would be if you navigated away mid-attach, a known, acceptable
  // V1 limitation rather than a bug.
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Only ever populated when senderStatus is CHOOSE_SENDER (a brand-new
  // conversation, company has 2+ active mailboxes) — see
  // getAvailableSenderAccountsAction's own doc comment. Empty in every
  // other case, so the picker below simply never renders.
  const [senderAccounts, setSenderAccounts] = useState<AvailableSenderAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  useEffect(() => {
    if (senderStatus.status !== "CHOOSE_SENDER") {
      setSenderAccounts([]);
      setSelectedAccountId("");
      return;
    }
    let cancelled = false;
    getAvailableSenderAccountsAction(contact.id).then((result) => {
      if (!cancelled) setSenderAccounts(result.accounts);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only when the contact or its CHOOSE_SENDER-ness changes, not on every senderStatus object identity change
  }, [contact.id, senderStatus.status]);

  function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setAttachmentError(undefined);
    const accepted: File[] = [];
    for (const file of Array.from(files)) {
      const validationError = validateAttachment(file.type, file.size);
      if (validationError === "TYPE_NOT_ALLOWED") {
        setAttachmentError(t(`"${file.name}" isn't a supported file type.`, `"${file.name}" no es un tipo de archivo compatible.`));
        continue;
      }
      if (validationError === "TOO_LARGE") {
        setAttachmentError(t(`"${file.name}" is too large.`, `"${file.name}" es demasiado grande.`));
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length > 0) setAttachedFiles((prev) => [...prev, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachedFile(index: number) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  // immediatelyRender: false is required for Tiptap under Next.js SSR —
  // without it, the editor renders its initial (empty) content during SSR
  // and again, differently, on the client's first paint, which is exactly
  // the class of hydration mismatch that made Send reply unresponsive
  // before (see the draft-loading effect below's own doc comment on that
  // earlier bug) — this setting exists specifically to prevent a repeat.
  const editor = useEditor({
    extensions: [
      StarterKit,
      TiptapUnderline,
      TiptapLink.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }),
      TiptapPlaceholder.configure({ placeholder: t("Write a reply...", "Escribe una respuesta...") }),
    ],
    content: "",
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      setBodyHtml(editor.getHTML());
      setBodyText(editor.getText());
    },
  });

  // Restored once per contact (this component remounts on every contact
  // switch via its `key={selected.id}` in CorreoClient — see below), never
  // copied from a different contact's draft: the lookup is keyed by this
  // exact contact.id/companyId, nothing else. Deliberately loaded in an
  // effect rather than synchronously during render: localStorage doesn't
  // exist during SSR, so reading it synchronously made the server's first
  // render (always "no draft") disagree with the client's very first
  // render (the real draft, already in localStorage) — a genuine hydration
  // mismatch that made React discard and regenerate this subtree, which is
  // what made Send reply (and every other control in this panel) appear
  // unresponsive right after a fresh page load. Loading it a tick later,
  // after the SSR-identical first paint, avoids the mismatch entirely.
  // Also waits on `editor` specifically (null until Tiptap finishes its
  // own deferred first render, per immediatelyRender: false above) since
  // editor.commands.setContent needs a real editor instance to call.
  //
  // Backward compatible with a draft saved BEFORE formatted composing
  // existed: an old draft has `body` (plain text), a new one has
  // `bodyHtml` — either is read and loaded losslessly; nothing is ever
  // silently discarded just because the storage shape changed.
  useEffect(() => {
    if (!editor || draftLoaded) return;
    const draft = loadDraft<EmailDraft & LegacyEmailDraft>("email", userId, contact.companyId, contact.id);
    if (draft?.subject) setSubject(draft.subject);
    if (draft?.bodyHtml) {
      editor.commands.setContent(draft.bodyHtml);
    } else if (draft?.body) {
      editor.commands.setContent(legacyDraftToHtml(draft.body));
    }
    setBodyHtml(editor.getHTML());
    setBodyText(editor.getText());
    setDraftLoaded(true);
  }, [editor, draftLoaded, userId, contact.companyId, contact.id]);

  const recipientValid = !!contact.email && isValidEmailFormat(contact.email);
  const subjectValid = subject.trim().length > 0;
  const bodyValid = bodyText.trim().length > 0;
  const emailAvailable = senderStatus.status !== "NOT_CONFIGURED";
  // CHOOSE_SENDER means there's genuinely no single answer yet — sending
  // must wait for an explicit pick from the list below, same "never guess
  // the sender" principle as the server-side resolveAccountForNewConversation.
  const needsSenderChoice = senderStatus.status === "CHOOSE_SENDER" && !selectedAccountId;
  const canSend = emailAvailable && !needsSenderChoice && recipientValid && subjectValid && bodyValid;
  const validationMessage = !emailAvailable
    ? undefined // the "not configured" banner below already explains this
    : needsSenderChoice
      ? t("Choose which mailbox to send from.", "Elige desde qué buzón enviar.")
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
    const hasContent = subject.trim().length > 0 || bodyText.trim().length > 0;
    if (!hasContent) {
      clearDraft("email", userId, contact.companyId, contact.id);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs a warning banner to an external system (localStorage write outcome), not a reactive cascade
      setDraftWarning(undefined);
      return;
    }
    const ok = saveDraft("email", userId, contact.companyId, contact.id, { subject, bodyHtml });
    setDraftWarning(
      ok
        ? undefined
        : t(
            "Your draft couldn't be saved locally — copy your text before switching contacts.",
            "No se pudo guardar tu borrador localmente: copia el texto antes de cambiar de contacto."
          )
    );
  }, [subject, bodyHtml, bodyText, userId, contact.companyId, contact.id, t, draftLoaded]);

  async function handleSend() {
    if (!canSend || sending) return;
    setSending(true);
    setError(undefined);
    const result = await sendEmailAction({
      contactId: contact.id,
      subject,
      bodyText,
      bodyHtml,
      attachments: attachedFiles,
      // The exact thread currently open — never omitted when one exists,
      // so a reply can never land on (or send from) a different one of
      // this contact's conversations than the one actually being viewed.
      conversationId: conversation?.id,
      accountId: selectedAccountId || undefined,
    });
    setSending(false);
    if (result.error) {
      // Send failed — keep the draft (and selected attachments) exactly
      // as-is so the user can retry without re-picking files.
      setError(result.error);
      return;
    }
    clearDraft("email", userId, contact.companyId, contact.id);
    editor?.commands.clearContent();
    setBodyHtml("");
    setBodyText("");
    setAttachedFiles([]);
    onSent();
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-[18px] font-semibold text-text-primary">{contact.name}</h2>
        {conversations.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label={t("Email threads", "Hilos de correo")}>
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={conversation?.id === c.id}
                onClick={() => onSelectThread(c.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                  conversation?.id === c.id
                    ? "border-brand bg-brand-50 text-brand"
                    : "border-border bg-white text-text-secondary hover:bg-surface-muted"
                )}
              >
                {c.emailProvider && <ProviderIcon provider={c.emailProvider} className="h-3 w-3" />}
                {c.emailProvider === "SMTP_IMAP" ? t("Webmail", "Webmail") : c.emailProvider === "GOOGLE_WORKSPACE" ? "Gmail" : t("Other", "Otro")}
              </button>
            ))}
          </div>
        )}
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
        <p className="flex items-center gap-1.5 text-[13px] text-text-secondary">
          {(senderStatus.status === "CONNECTED_GMAIL" || senderStatus.status === "CONNECTED_SMTP") && (
            <ProviderIcon provider={senderStatus.status === "CONNECTED_GMAIL" ? "GOOGLE_WORKSPACE" : "SMTP_IMAP"} className="h-3.5 w-3.5" />
          )}
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
        {senderStatus.status === "CHOOSE_SENDER" && senderAccounts.length > 0 && (
          <div className="mt-2">
            <label className="mb-1 block text-[11px] font-semibold tracking-wide text-text-secondary">
              {t("SEND FROM", "ENVIAR DESDE")}
            </label>
            <Select value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)}>
              <option value="">{t("Select a mailbox...", "Selecciona un buzón...")}</option>
              {senderAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.emailAddress} {a.provider === "SMTP_IMAP" ? t("(Webmail)", "(Webmail)") : "(Gmail)"}
                </option>
              ))}
            </Select>
          </div>
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
              <EmailMessageBody body={m.body} metadata={m.metadata} />
              <EmailAttachmentList messageId={m.id} metadata={m.metadata} />
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
        <ComposerToolbar editor={editor} onAttachClick={() => fileInputRef.current?.click()} />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={Object.keys(ALLOWED_ATTACHMENT_TYPES).join(",")}
          className="hidden"
          onChange={(e) => handleFilesSelected(e.target.files)}
        />
        <EditorContent
          editor={editor}
          className={cn(
            "min-h-[76px] rounded-xl border border-border px-3 py-2 text-[14px] text-text-primary",
            "[&_.ProseMirror]:min-h-[60px] [&_.ProseMirror]:outline-none",
            "[&_.ProseMirror_p]:my-1 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_a]:text-brand [&_.ProseMirror_a]:underline",
            // Tiptap's Placeholder extension marks the empty paragraph with
            // a data-placeholder attribute + is-editor-empty class but
            // deliberately injects no CSS of its own — this is the
            // standard Tailwind-based rule that actually displays it.
            "[&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:text-text-tertiary [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]"
          )}
        />
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-muted px-2.5 py-1.5 text-[12px] text-text-primary"
              >
                <span className="max-w-[160px] truncate">{file.name}</span>
                <span className="text-text-tertiary">{formatFileSize(file.size)}</span>
                <button type="button" onClick={() => removeAttachedFile(index)} className="text-text-tertiary hover:text-danger">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachmentError && <p className="text-[12px] text-danger">{attachmentError}</p>}
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
              <EmailMessageBody body={m.body} metadata={m.metadata} />
              <EmailAttachmentList messageId={m.id} metadata={m.metadata} />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
