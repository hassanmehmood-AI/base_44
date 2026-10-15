"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
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
import type { PlatformConnectionStatus } from "@/server/services/social";
import {
  getConversationDetailAction,
  replyToConversationAction,
  linkContactAction,
  updateConversationAssigneeAction,
  getAssignableUsersAction,
} from "./actions";

type SocialPlatform = "FACEBOOK" | "INSTAGRAM";

/** Platform-specific visual accents for the Social Media page only — purely
 * presentational (colors/backgrounds), never affects which conversations
 * load or how they're filtered (that's still platform/company state above).
 * Applied via inline `style` rather than competing Tailwind background
 * classes: this repo's `cn()` is a plain joiner (no tailwind-merge dedupe),
 * so a utility class passed alongside a component's own variant class (e.g.
 * Button's `bg-sidebar-active`) has no guaranteed override order — inline
 * style always wins deterministically instead. Gradients (Instagram) also
 * aren't expressible as a shared design-system token, so inline style is the
 * one mechanism that covers both platforms uniformly. */
const PLATFORM_THEME: Record<
  SocialPlatform,
  { accent: string; accentSoft: string; outgoingBubble: string; actionBackground: string }
> = {
  FACEBOOK: {
    accent: "#1877F2",
    accentSoft: "#EAF3FF",
    outgoingBubble: "#0084FF",
    actionBackground: "#0084FF",
  },
  INSTAGRAM: {
    accent: "#C13584",
    accentSoft: "#FDF2FA",
    outgoingBubble: "linear-gradient(135deg, #833AB4 0%, #C13584 55%, #F77737 100%)",
    actionBackground: "linear-gradient(135deg, #833AB4 0%, #C13584 55%, #F77737 100%)",
  },
};

function FacebookIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
      <path d="M13.5 21v-7.5h2.52l.38-2.93h-2.9V8.73c0-.85.23-1.43 1.46-1.43h1.56V4.68c-.27-.04-1.2-.11-2.28-.11-2.26 0-3.8 1.38-3.8 3.91v2.18H8.1v2.93h2.44V21h2.96Z" />
    </svg>
  );
}

function InstagramIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="16.9" cy="7.1" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RedesSocialesClient({
  conversations: initialConversations,
  contacts,
  platformStatus,
  initialSelectedId,
  initialMessages,
}: {
  conversations: ConversationWithJoins[];
  contacts: ContactWithJoins[];
  platformStatus: Record<string, PlatformConnectionStatus>;
  initialSelectedId: string | null;
  initialMessages: Message[];
}) {
  const { t, language } = useLanguage();
  const { activeCompany, setActiveCompany } = useCompany();
  const [conversations, setConversations] = useState(initialConversations);
  const [platform, setPlatform] = useState<SocialPlatform>("FACEBOOK");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState("");

  const companyScoped = conversations.filter((c) => activeCompany === ALL_COMPANIES || c.companyName === activeCompany);
  const filtered = companyScoped.filter((c) => c.platform === platform);

  // Searches the sender/subject text actually shown on each row — a social
  // conversation doesn't carry its own phone/email (that lives on the linked
  // contact, if any), so those aren't searchable here.
  const searched = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter(
      (c) => (c.contactName ?? "").toLowerCase().includes(q) || (c.subject ?? "").toLowerCase().includes(q)
    );
  })();

  // Looked up from the searched/company-and-platform-scoped list (not raw
  // `conversations`): a conversation selected before switching companies,
  // switching platform tabs, or searching must stop showing once it's
  // filtered out, falling back to the empty state instead of another,
  // unrelated conversation (e.g. an Instagram thread never shows while the
  // Facebook tab is active).
  const selected = searched.find((c) => c.id === selectedId);

  // Only meaningful for a single selected company — connection status isn't
  // aggregated across companies, so "All companies" never claims a platform
  // is disconnected (the generic empty state covers it instead). Missing
  // status data (e.g. a company status failed to load) also falls back to
  // the generic empty state rather than wrongly claiming "disconnected".
  const activePlatformConnected =
    activeCompany === ALL_COMPANIES
      ? true
      : (platformStatus[activeCompany]?.[platform === "FACEBOOK" ? "facebookConnected" : "instagramConnected"] ?? true);

  const theme = PLATFORM_THEME[platform];
  const PlatformIcon = platform === "FACEBOOK" ? FacebookIcon : InstagramIcon;
  const platformLabel = platform === "FACEBOOK" ? t("Facebook", "Facebook") : t("Instagram", "Instagram");

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
        actions={
          <SearchInput
            placeholder={t("Search client, phone or email...", "Buscar cliente, teléfono o correo...")}
            className="max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-3">
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

        <div
          role="tablist"
          aria-label={t("Platform", "Plataforma")}
          className="inline-flex gap-1 rounded-xl border border-border bg-surface-muted p-1"
        >
          {(
            [
              { key: "FACEBOOK", label: t("Facebook", "Facebook"), Icon: FacebookIcon },
              { key: "INSTAGRAM", label: t("Instagram", "Instagram"), Icon: InstagramIcon },
            ] as const
          ).map(({ key, label, Icon }) => {
            const active = platform === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPlatform(key)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  active ? "bg-white text-text-primary shadow-[var(--shadow-button)]" : "text-text-secondary hover:text-text-primary"
                )}
              >
                <Icon className="h-4 w-4" style={active ? { color: PLATFORM_THEME[key].accent } : undefined} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr_280px]">
        {/* Height capped to the viewport (same convention as the CRM contacts
            card) so a growing conversation count scrolls inside this panel
            instead of lengthening the whole page; header stays outside the
            scrollable region. */}
        <Card className="flex max-h-[calc(100vh-280px)] min-h-[520px] flex-col gap-3 p-5">
          <div className="flex shrink-0 items-center justify-between">
            <CardTitle>{t("Social inbox", "Bandeja social")}</CardTitle>
            <Badge tone="outline" style={{ backgroundColor: theme.accentSoft, color: theme.accent, borderColor: theme.accentSoft }}>
              {searched.length}
            </Badge>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {searched.map((c) => {
              const isSelected = selectedId === c.id;
              const customerName = c.contactName ?? c.subject ?? t("Unknown sender", "Remitente desconocido");
              return (
                <button
                  key={c.id}
                  onClick={() => selectConversation(c.id)}
                  style={isSelected ? { backgroundColor: theme.accentSoft } : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors",
                    !isSelected && (platform === "FACEBOOK" ? "hover:bg-[#EAF3FF]" : "hover:bg-[#FDF2FA]")
                  )}
                >
                  <Avatar name={customerName} imageUrl={c.customerAvatarUrl} size={36} />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-text-primary">{customerName}</span>
                    <span className="flex items-center gap-1 truncate text-[11.5px] text-text-secondary">
                      <PlatformIcon className="h-3 w-3 shrink-0" style={{ color: theme.accent }} />
                      <span className="truncate">{platformLabel} · {c.companyName}</span>
                    </span>
                    {(!c.contactId || c.lastMessageAt) && (
                      <span className="flex items-center gap-1 text-[11px]">
                        {!c.contactId && <span className="text-warning-700">{t("Unmatched", "Sin asociar")}</span>}
                        {!c.contactId && c.lastMessageAt && <span className="text-text-tertiary">·</span>}
                        {c.lastMessageAt && (
                          <span className="text-text-tertiary" suppressHydrationWarning>
                            {formatRelativeTime(c.lastMessageAt, language)}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
            {searched.length === 0 && (
              <p className="py-6 text-center text-[13px] text-text-tertiary">
                {filtered.length > 0
                  ? t("No conversations match your search.", "Ninguna conversación coincide con tu búsqueda.")
                  : !activePlatformConnected
                    ? platform === "FACEBOOK"
                      ? t("Facebook isn't connected for this company yet.", "Facebook aún no está conectado para esta empresa.")
                      : t("Instagram isn't connected for this company yet.", "Instagram aún no está conectado para esta empresa.")
                    : t("No social messages yet. They'll appear here once the channel is connected.", "Aún no hay mensajes. Aparecerán aquí cuando el canal esté conectado.")}
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
              platform={platform}
            />
            <SidePanel
              key={`${selected.id}-side`}
              conversation={selected}
              contacts={contacts}
              onLinked={refreshDetail}
              platform={platform}
            />
          </>
        ) : (
          <Card className="flex max-h-[calc(100vh-280px)] min-h-[520px] items-center justify-center p-6 text-[13.5px] text-text-tertiary lg:col-span-2">
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
  platform,
}: {
  conversation: ConversationWithJoins;
  messages: Message[];
  loadingDetail: boolean;
  onSent: () => void;
  platform: SocialPlatform;
}) {
  const { t, language } = useLanguage();
  const theme = PLATFORM_THEME[platform];
  const PlatformIcon = platform === "FACEBOOK" ? FacebookIcon : InstagramIcon;
  const platformLabel = platform === "FACEBOOK" ? t("Facebook", "Facebook") : t("Instagram", "Instagram");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const messagesRef = useRef<HTMLDivElement>(null);

  // Jump to the latest message whenever the conversation's history changes —
  // the message list now scrolls inside a fixed-height card (see layout
  // fix above), so without this a long conversation would open scrolled to
  // its oldest message instead of the newest.
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation.id, messages]);

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
    <Card className="flex max-h-[calc(100vh-280px)] min-h-[520px] flex-col gap-4 p-6">
      <div className="shrink-0">
        <p className="text-[15px] font-semibold text-text-primary">
          {conversation.contactName ?? conversation.subject ?? t("Unknown sender", "Remitente desconocido")}
        </p>
        <p className="flex items-center gap-1 text-[12.5px] text-text-secondary">
          <PlatformIcon className="h-3.5 w-3.5" style={{ color: theme.accent }} />
          {platformLabel} · {conversation.companyName}
        </p>
      </div>

      <div ref={messagesRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {loadingDetail ? (
          <p className="py-6 text-center text-[13.5px] text-text-tertiary">{t("Loading...", "Cargando...")}</p>
        ) : messages.length === 0 ? (
          <p className="rounded-2xl bg-surface-muted px-4 py-3 text-center text-[13.5px] text-text-tertiary">
            {t("No messages in this conversation yet.", "Aún no hay mensajes en esta conversación.")}
          </p>
        ) : (
          messages.map((m) => {
            const outbound = m.direction === "OUTBOUND";
            return (
              <div
                key={m.id}
                style={outbound ? { background: theme.outgoingBubble } : undefined}
                className={cn(
                  "max-w-[75%] rounded-2xl px-4 py-3 text-[14px]",
                  outbound ? "ml-auto rounded-br-md text-white" : "rounded-bl-md bg-surface-muted text-text-primary"
                )}
              >
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={cn("mt-1 text-[11px]", outbound ? "text-white/80" : "text-text-tertiary")} suppressHydrationWarning>
                  {outbound ? t("You", "Tú") : (m.senderLabel ?? "")} · {formatRelativeTime(m.sentAt, language)}
                </p>
              </div>
            );
          })
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-3 border-t border-border pt-4">
        <Textarea rows={3} placeholder={t("Write a reply...", "Escribe una respuesta...")} value={reply} onChange={(e) => setReply(e.target.value)} />
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <Button
          className="w-fit self-end transition-[filter] hover:brightness-95 active:brightness-90"
          style={{ background: theme.actionBackground, color: "#fff" }}
          disabled={sending}
          onClick={handleSend}
        >
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
  platform,
}: {
  conversation: ConversationWithJoins;
  contacts: ContactWithJoins[];
  onLinked: () => void;
  platform: SocialPlatform;
}) {
  const { t } = useLanguage();
  const theme = PLATFORM_THEME[platform];
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
    <Card className="flex max-h-[calc(100vh-280px)] min-h-[520px] flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center gap-3">
        <div className="shrink-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${theme.accent}` }}>
          <Avatar
            name={conversation.contactName ?? conversation.subject ?? "?"}
            imageUrl={conversation.customerAvatarUrl}
            size={44}
          />
        </div>
        <div>
          <p className="text-[14.5px] font-semibold text-text-primary">
            {conversation.contactName ?? conversation.subject ?? t("Unknown sender", "Remitente desconocido")}
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
