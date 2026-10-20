"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Send, MoreHorizontal, Building2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SearchInput, Select } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { useLanguage, type Language } from "@/context/LanguageContext";
import { useCompany, ALL_COMPANIES } from "@/context/CompanyContext";
import { Stage, STAGE_LABEL, STAGE_LABEL_ES } from "@/lib/pipeline";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ConversationWithJoins } from "@/server/repositories/conversations";
import type { Message } from "@/server/repositories/messages";
import {
  listWhatsappConversationsAction,
  getWhatsappConversationDetailAction,
  replyToWhatsappConversationAction,
} from "./actions";
import { useWhatsappRealtime } from "./useWhatsappRealtime";
import { type WhatsappView, buildWhatsappSearchParams } from "./whatsappUrlState";

/** Same seven stages the original mock Pipeline View used — preserved
 * exactly (see the git history for this file's predecessor) — plus one
 * extra, non-Stage bucket for the very common real-world case the mock
 * never had to model: a brand-new inbound WhatsApp message with no linked
 * CRM contact yet (see repositories/conversations.ts's contactStageKey doc
 * comment, and services/social.ts's equivalent linkConversationToContact
 * flow for the Social Media page — WhatsApp has no such linking UI yet,
 * out of scope for this pass). */
const STAGE_COLUMNS: Stage[] = [
  "NUEVO_LEAD",
  "CONTACTADO",
  "INTERESADO",
  "OPORTUNIDAD",
  "PEDIDO_EN_CURSO",
  "CLIENTE",
  "SEGUIMIENTO",
];

export function WhatsAppClient({
  conversations: initialConversations,
  initialSelectedId,
  initialMessages,
  initialView,
}: {
  conversations: ConversationWithJoins[];
  initialSelectedId: string | null;
  initialMessages: Message[];
  /** Resolved server-side (see page.tsx) from the URL's `view` query param
   * via resolveInitialView — this is what makes the Chat view (and the
   * open conversation) survive a plain browser refresh instead of always
   * resetting to the Pipeline view. */
  initialView: WhatsappView;
}) {
  const { t, language } = useLanguage();
  const { activeCompany, setActiveCompany } = useCompany();
  const router = useRouter();
  const pathname = usePathname();
  const [conversations, setConversations] = useState(initialConversations);
  const [view, setView] = useState<WhatsappView>(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState("");

  const stageLabels = language === "es" ? STAGE_LABEL_ES : STAGE_LABEL;

  const companyScoped = conversations.filter((c) => activeCompany === ALL_COMPANIES || c.companyName === activeCompany);

  const query = search.trim().toLowerCase();
  const matchesSearch = (c: ConversationWithJoins) =>
    !query || (c.contactName ?? c.subject ?? "").toLowerCase().includes(query);
  const filteredConversations = companyScoped.filter(matchesSearch);

  const selected = filteredConversations.find((c) => c.id === selectedId);

  function applyConversationUpdate(updated: ConversationWithJoins) {
    setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  async function selectConversation(id: string) {
    setSelectedId(id);
    setMessages([]);
    setLoadingDetail(true);
    const result = await getWhatsappConversationDetailAction(id);
    if (result) {
      setMessages(result.messages);
      applyConversationUpdate(result.conversation);
    }
    setLoadingDetail(false);
    setView("chat");
  }

  async function refreshDetail() {
    if (!selectedId) return;
    const result = await getWhatsappConversationDetailAction(selectedId);
    if (result) {
      setMessages(result.messages);
      applyConversationUpdate(result.conversation);
    }
  }

  async function refreshConversationList() {
    const fresh = await listWhatsappConversationsAction();
    setConversations(fresh);
  }

  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Keeps the URL in sync with the current view/conversation — never
  // navigates or reloads anything (router.replace only updates history +
  // the address bar), so this can't interfere with messaging, Metricool
  // sync, or the WebSocket connection. page.tsx (the read half) resolves
  // initialView/initialSelectedId from these exact same query param names
  // on the next load, so a plain browser refresh — which re-enters
  // page.tsx with whatever is currently in the address bar — lands back on
  // the same view and conversation instead of always resetting to Pipeline
  // with no chat open.
  useEffect(() => {
    const query = buildWhatsappSearchParams(view, selectedId);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }, [view, selectedId, pathname, router]);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleRefresh(options: { alwaysRefreshDetail: boolean; conversationId: string | null }) {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      refreshConversationList().catch((e) => console.error("[realtime] failed to refresh WhatsApp conversation list:", e));
      const shouldRefreshDetail =
        options.alwaysRefreshDetail || (options.conversationId !== null && options.conversationId === selectedIdRef.current);
      if (shouldRefreshDetail) {
        refreshDetail().catch((e) => console.error("[realtime] failed to refresh WhatsApp conversation detail:", e));
      }
    }, 300);
  }

  // Same channel-agnostic realtime pointer the Social Media page uses — see
  // useWhatsappRealtime.ts's doc comment for why no backend change was
  // needed for this to also cover WhatsApp messages.
  useWhatsappRealtime((event) => {
    if ("reconnected" in event) {
      scheduleRefresh({ alwaysRefreshDetail: true, conversationId: null });
    } else {
      scheduleRefresh({ alwaysRefreshDetail: false, conversationId: event.conversationId });
    }
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="WhatsApp"
        subtitle={t("Manage conversations and move each one according to its commercial stage", "Gestiona conversaciones y mueve cada una según su estado comercial")}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg bg-text-primary p-1">
          <button
            onClick={() => setView("pipeline")}
            className={cn(
              "rounded-md px-4 py-1.5 text-[13.5px] font-medium transition-colors",
              view === "pipeline" ? "bg-white text-text-primary" : "text-white/70 hover:text-white"
            )}
          >
            {t("Pipeline View", "Vista Pipeline")}
          </button>
          <button
            onClick={() => setView("chat")}
            className={cn(
              "rounded-md px-4 py-1.5 text-[13.5px] font-medium transition-colors",
              view === "chat" ? "bg-white text-text-primary" : "text-white/70 hover:text-white"
            )}
          >
            {t("Chat View", "Vista Chat")}
          </button>
        </div>
        <SearchInput
          placeholder={t("Search client...", "Buscar cliente...")}
          className="max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button
          className="ml-auto"
          disabled
          title={t(
            "New WhatsApp conversations are created automatically from the first inbound message — there's no manual start yet.",
            "Las conversaciones nuevas de WhatsApp se crean automáticamente con el primer mensaje recibido — todavía no se pueden iniciar manualmente."
          )}
        >
          {t("New conversation", "Nueva conversación")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-text-secondary">
          {t("Active company on this channel:", "Empresa activa en este canal:")}{" "}
          <span className="font-semibold text-text-primary">
            {activeCompany === ALL_COMPANIES ? t("all companies", "todas las empresas") : activeCompany}
          </span>
        </p>
        <div className="w-[200px]">
          <Select value={activeCompany} onChange={(e) => setActiveCompany(e.target.value)}>
            <option value={ALL_COMPANIES}>{t("All companies", "Todas las empresas")}</option>
            {[...new Set(conversations.map((c) => c.companyName))].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {view === "pipeline" ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {/* Unassigned bucket first — the real-world state the original
              mock design never had to represent (a fresh inbound message
              with no linked contact yet). */}
          <PipelineColumn
            label={t("UNASSIGNED", "SIN ASIGNAR")}
            cards={filteredConversations.filter((c) => !c.contactStageKey)}
            onSelect={selectConversation}
            language={language}
            t={t}
          />
          {STAGE_COLUMNS.map((stage) => (
            <PipelineColumn
              key={stage}
              label={stageLabels[stage].toUpperCase()}
              cards={filteredConversations.filter((c) => c.contactStageKey === stage)}
              onSelect={selectConversation}
              language={language}
              t={t}
            />
          ))}
        </div>
      ) : (
        <Card className="flex h-[640px] overflow-hidden p-0">
          <div className="flex w-[300px] shrink-0 flex-col border-r border-border">
            <div className="border-b border-border p-4">
              <p className="text-[15px] font-semibold text-text-primary">{t("Conversations", "Conversaciones")}</p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredConversations.map((c) => {
                const name = c.contactName ?? c.subject ?? t("Unknown sender", "Remitente desconocido");
                return (
                  <button
                    key={c.id}
                    onClick={() => selectConversation(c.id)}
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors",
                      selectedId === c.id ? "bg-brand-50" : "hover:bg-surface-muted"
                    )}
                  >
                    <Avatar name={name} imageUrl={c.customerAvatarKey ? `/api/avatars/${c.id}` : c.customerAvatarUrl} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold text-text-primary">{name}</p>
                      <p className="truncate text-[12px] text-text-tertiary">
                        {c.contactStageKey ? stageLabels[c.contactStageKey as Stage] ?? c.contactStageKey : t("Unassigned", "Sin asignar")}
                      </p>
                    </div>
                    {c.lastMessageAt && (
                      <span className="shrink-0 text-[11px] text-text-tertiary" suppressHydrationWarning>
                        {formatRelativeTime(c.lastMessageAt, language)}
                      </span>
                    )}
                  </button>
                );
              })}
              {filteredConversations.length === 0 && (
                <p className="px-4 py-6 text-center text-[13px] text-text-tertiary">
                  {t("No WhatsApp messages yet. They'll appear here once a channel is connected.", "Aún no hay mensajes de WhatsApp. Aparecerán aquí cuando un canal esté conectado.")}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-1 flex-col">
            {selected ? (
              <ChatPane key={selected.id} conversation={selected} messages={messages} loadingDetail={loadingDetail} onSent={refreshDetail} />
            ) : (
              <div className="flex flex-1 items-center justify-center text-text-tertiary">
                <div className="text-center">
                  <Building2 className="mx-auto mb-2 h-6 w-6" />
                  {t("Select a conversation", "Selecciona una conversación")}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function PipelineColumn({
  label,
  cards,
  onSelect,
  language,
  t,
}: {
  label: string;
  cards: ConversationWithJoins[];
  onSelect: (id: string) => void;
  language: Language;
  t: (en: string, es: string) => string;
}) {
  return (
    <div className="w-[260px] shrink-0 rounded-xl bg-surface-muted/60 p-2.5">
      <div className="mb-3 flex items-center gap-2 px-0.5">
        <p className="text-[11px] font-semibold tracking-wide text-text-secondary">{label}</p>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-semibold text-text-secondary">
          {cards.length}
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        {cards.map((c) => {
          const name = c.contactName ?? c.subject ?? t("Unknown sender", "Remitente desconocido");
          return (
            <Card key={c.id} className="cursor-pointer p-3.5 transition-shadow hover:shadow-md" onClick={() => onSelect(c.id)}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <Avatar name={name} imageUrl={c.customerAvatarKey ? `/api/avatars/${c.id}` : c.customerAvatarUrl} size={30} />
                  <div>
                    <p className="text-[13.5px] font-semibold text-text-primary">{name}</p>
                    <p className="text-[11.5px] text-text-tertiary" suppressHydrationWarning>
                      {t("Last message", "Último mensaje")} · {c.lastMessageAt ? formatRelativeTime(c.lastMessageAt, language) : "—"}
                    </p>
                  </div>
                </div>
                <button className="text-text-tertiary hover:text-text-primary" aria-hidden="true" tabIndex={-1}>
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </div>
            </Card>
          );
        })}
        {cards.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-white/60 py-6 text-center text-[12.5px] text-text-tertiary">
            {t("No conversations", "Sin conversaciones")}
          </div>
        )}
      </div>
    </div>
  );
}

function ChatPane({
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
  const messagesRef = useRef<HTMLDivElement>(null);
  const name = conversation.contactName ?? conversation.subject ?? t("Unknown sender", "Remitente desconocido");

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation.id, messages]);

  async function handleSend() {
    if (!reply.trim() || sending) return;
    setSending(true);
    setError(undefined);
    const result = await replyToWhatsappConversationAction(conversation.id, reply);
    setSending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setReply("");
    onSent();
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border p-4">
        <Avatar name={name} imageUrl={conversation.customerAvatarKey ? `/api/avatars/${conversation.id}` : conversation.customerAvatarUrl} size={38} />
        <div>
          <p className="text-[14.5px] font-semibold text-text-primary">{name}</p>
          <p className="text-[12px] text-text-secondary">{conversation.companyName}</p>
        </div>
      </div>
      <div ref={messagesRef} className="flex-1 space-y-3 overflow-y-auto bg-surface-muted/60 p-5">
        {loadingDetail ? (
          <p className="py-6 text-center text-[13.5px] text-text-tertiary">{t("Loading...", "Cargando...")}</p>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-[13.5px] text-text-tertiary">
            {t("No messages in this conversation yet.", "Aún no hay mensajes en esta conversación.")}
          </p>
        ) : (
          messages.map((m) => {
            const outbound = m.direction === "OUTBOUND";
            return (
              <div
                key={m.id}
                className={cn(
                  "max-w-[70%] rounded-2xl px-4 py-2.5 text-[13.5px] shadow-sm",
                  outbound ? "ml-auto rounded-tr-sm bg-brand text-white" : "rounded-tl-sm bg-white"
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
      <div className="flex flex-col gap-2 border-t border-border p-4">
        <div className="flex items-center gap-3">
          <input
            placeholder={t("Write a message...", "Escribe un mensaje...")}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            className="h-10 flex-1 rounded-full border border-border px-4 text-[14px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
          <Button size="md" className="rounded-full !px-3" disabled={sending} onClick={handleSend}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {error && <p className="text-[12.5px] text-danger">{error}</p>}
      </div>
    </>
  );
}
