"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneCall, PhoneOff, AlertTriangle } from "lucide-react";
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
import { formatRelativeTime, formatDateTime } from "@/lib/format";
import { getActivityLabel } from "@/lib/activities";
import { STAGE_LABEL, STAGE_LABEL_ES, type Stage } from "@/lib/pipeline";
import type { ContactWithJoins } from "@/server/repositories/contacts";
import type { ActivityWithAuthor } from "@/server/repositories/activities";
import type { Call, CallWithContact } from "@/server/repositories/calls";
import type { PipelineStage } from "@/server/repositories/pipelineStages";
import type { CallingStatusForCurrentUser } from "@/server/services/calls";
import { CALL_STATUSES, type CallStatus } from "@/server/constants";
import { getContactCallDetailAction, getCompanyCallHistoryAction, initiateCallAction, authorizeCallAction, logCallResultAction } from "./actions";
import { ZadarmaPhoneProvider, useZadarmaPhone } from "./ZadarmaPhoneProvider";

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

/** Persistent, page-level status + controls bar — always mounted once
 * (not per selected contact), reflecting the one shared ZadarmaPhoneProvider
 * context every other calling UI on this page reads from. This is the
 * "professional, unified calling experience" surface: Zadarma's own
 * default widget UI is loaded (required — it's the only confirmed way to
 * bootstrap the underlying calling engine) but immediately hidden (see
 * ZadarmaPhoneProvider's hideDefaultWidgetUi), with these GrowthOn-styled
 * controls driving the same underlying session instead. */
function ZadarmaCallBar() {
  const { t } = useLanguage();
  const phone = useZadarmaPhone();
  if (!phone) return null;

  const { status, unavailableReason, incomingNumber, muted, answerCall, rejectCall, hangUp, toggleMute } = phone;

  const statusText: Record<typeof status, string> = {
    checking: t("Connecting to browser calling...", "Conectando a llamadas desde el navegador..."),
    not_leader: t("Browser calling is active in another tab.", "Las llamadas desde el navegador están activas en otra pestaña."),
    unavailable: t("Browser calling isn't available yet.", "Las llamadas desde el navegador aún no están disponibles."),
    mic_denied: t("Browser calling couldn't access your microphone:", "Las llamadas desde el navegador no pudieron acceder a tu micrófono:"),
    connecting: t("Setting up browser calling...", "Configurando llamadas desde el navegador..."),
    ready: t("Browser calling is ready — use the Call button on a lead.", "Las llamadas desde el navegador están listas — usa el botón Llamar en un cliente."),
    on_call: t("Call in progress.", "Llamada en curso."),
    incoming: t("Incoming call", "Llamada entrante"),
  };

  return (
    <Card className={cn("flex flex-wrap items-center gap-3 p-4", status === "incoming" && "border-brand bg-brand-50")}>
      <Phone className="h-4 w-4 shrink-0 text-text-tertiary" />
      <p className="flex-1 text-[12.5px] text-text-secondary">
        {statusText[status]}
        {(status === "unavailable" || status === "mic_denied") && unavailableReason ? ` ${unavailableReason}` : ""}
        {status === "incoming" && incomingNumber ? ` — ${incomingNumber}` : ""}
      </p>

      {status === "incoming" && (
        <div className="flex gap-2">
          <Button size="sm" onClick={answerCall}>
            {t("Answer", "Responder")}
          </Button>
          <Button size="sm" variant="outline" onClick={rejectCall}>
            {t("Reject", "Rechazar")}
          </Button>
        </div>
      )}

      {status === "on_call" && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={toggleMute}>
            {muted ? t("Unmute", "Activar micrófono") : t("Mute", "Silenciar")}
          </Button>
          <Button size="sm" variant="outline" onClick={hangUp}>
            {t("Hang up", "Colgar")}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** mm:ss for the in-call stopwatch — never hours, since a single call
 * running past 59:59 is not a realistic case this page needs to handle. */
function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function LlamadasClient({
  queue,
  stages,
  callingStatuses,
  companyCallHistory,
  initialSelectedId,
  initialActivities,
  initialCalls,
  currentUserId,
}: {
  queue: ContactWithJoins[];
  stages: PipelineStage[];
  /** Account-wide Zadarma config flag + each allowed company's assigned
   * number (or null) — see services/calls.ts's getCallingStatusForCurrentUser.
   * Never Superuser-gated: any Agent/Manager/Director needs this just to
   * know whether/from-where they can call. */
  callingStatuses: CallingStatusForCurrentUser;
  /** Company-wide recent call log (every allowed company, not just the
   * selected contact's) — the bottom "recent call history" section. */
  companyCallHistory: CallWithContact[];
  initialSelectedId: string | null;
  initialActivities: ActivityWithAuthor[];
  initialCalls: Call[];
  /** Scopes ZadarmaPhoneProvider's multi-tab leader-election lock to THIS
   * signed-in agent — without it, two different agents sharing one browser
   * profile would fight over the same lock name and one could never
   * register their own extension (see the lock-scoping fix in
   * ZadarmaPhoneProvider.tsx). */
  currentUserId: string;
}) {
  const { t, language } = useLanguage();
  const { activeCompany, setActiveCompany } = useCompany();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [activities, setActivities] = useState(initialActivities);
  const [calls, setCalls] = useState(initialCalls);
  const [history, setHistory] = useState(companyCallHistory);
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

  const stageLabels = language === "es" ? STAGE_LABEL_ES : STAGE_LABEL;
  const statusLabels = language === "es" ? STATUS_LABEL_ES : STATUS_LABEL;

  // Status strip tied to the company dropdown itself (goal: "when a company
  // is selected, clearly show its assigned active Zadarma number") —
  // deliberately separate from the per-contact gating below, which is what
  // actually disables the call button.
  const activeCompanyStatus =
    activeCompany === ALL_COMPANIES ? null : callingStatuses.companies.find((c) => c.companyName === activeCompany);

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
    const [detail, companyHistory] = await Promise.all([getContactCallDetailAction(selectedId), getCompanyCallHistoryAction()]);
    setActivities(detail.activities);
    setCalls(detail.calls);
    setHistory(companyHistory);
  }

  return (
    <ZadarmaPhoneProvider lang={language} userId={currentUserId}>
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Call Management", "Gestión de Llamadas")}
        subtitle={t("Call queue, active call workspace, and results log", "Cola de llamadas, espacio de llamada activa y registro de resultados")}
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

        {activeCompanyStatus && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-white px-3.5 py-2">
            <Phone className="h-4 w-4 text-text-tertiary" />
            {activeCompanyStatus.number ? (
              <>
                <span className="text-[12.5px] text-text-secondary">{t("Calling from:", "Llamando desde:")}</span>
                <span className="text-[13px] font-semibold text-text-primary">{activeCompanyStatus.number}</span>
                <Badge tone="green">{t("Active", "Activo")}</Badge>
              </>
            ) : (
              <>
                <span className="text-[12.5px] text-text-secondary">{activeCompanyStatus.companyName}:</span>
                <Badge tone="red">{t("No number assigned", "Sin número asignado")}</Badge>
              </>
            )}
          </div>
        )}
      </div>

      {!callingStatuses.zadarmaConfigured && (
        <Card className="flex items-center gap-2.5 border-warning-100 bg-warning-50 p-4">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning-700" />
          <p className="text-[13px] text-warning-700">
            {t(
              "Zadarma calling isn't configured yet for this CRM — contact a Superuser to set it up before calls can be made.",
              "Las llamadas con Zadarma aún no están configuradas en este CRM — contacta a un Superusuario para configurarlo antes de poder llamar."
            )}
          </p>
        </Card>
      )}

      <ZadarmaCallBar />

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
                  "flex flex-col gap-1 rounded-xl px-3.5 py-2.5 text-left transition-colors",
                  selectedId === c.id ? "bg-brand-50" : "hover:bg-surface-muted"
                )}
              >
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 shrink-0 text-brand" />
                  <span className="truncate text-[13.5px] font-medium text-text-primary">{c.name}</span>
                </div>
                <div className="flex items-center justify-between gap-2 pl-5.5">
                  <span className="truncate text-[12px] text-text-tertiary">{c.phone}</span>
                  <StageBadge stage={c.stageKey} />
                </div>
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
          <CallWorkspace
            key={selected.id}
            contact={selected}
            callingStatus={callingStatuses.companies.find((c) => c.companyId === selected.companyId)}
            zadarmaConfigured={callingStatuses.zadarmaConfigured}
          />
        ) : (
          <Card className="flex items-center justify-center p-6 text-[13.5px] text-text-tertiary">
            {t("Select a client to start calling.", "Selecciona un cliente para empezar a llamar.")}
          </Card>
        )}

        {selected ? (
          <ContactDetailPanel
            key={`${selected.id}-detail`}
            contact={selected}
            stages={stages}
            activities={activities}
            calls={calls}
            statusLabels={statusLabels}
            stageLabels={stageLabels}
            loadingDetail={loadingDetail}
            onSaved={refreshDetail}
          />
        ) : (
          <Card className="hidden items-center justify-center p-6 text-[13.5px] text-text-tertiary lg:flex" />
        )}
      </div>

      <CompanyCallHistory history={history} statusLabels={statusLabels} />
    </div>
    </ZadarmaPhoneProvider>
  );
}

/** Center column — the active call workspace: who you're calling, which
 * number it goes out from, Start/End, status, and a local stopwatch.
 *
 * Deliberately NOT a live, carrier-verified call timer: Zadarma's
 * requestCallback is fire-and-forget (it tells Zadarma to ring the agent
 * first, then bridge to the contact) with no webhook wired in yet, so this
 * CRM has no real-time visibility into ringing/answered/ended. The timer
 * here is an honest, agent-controlled stopwatch — started on "Start Call",
 * stopped on "End Call" — not a claim about real telephony state. */
function CallWorkspace({
  contact,
  callingStatus,
  zadarmaConfigured,
}: {
  contact: ContactWithJoins;
  callingStatus: { number: string | null } | undefined;
  zadarmaConfigured: boolean;
}) {
  const { t } = useLanguage();
  const phone = useZadarmaPhone();
  const [state, setState] = useState<"idle" | "requesting" | "in_call" | "ended">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [viaBrowser, setViaBrowser] = useState(false);
  // True only right after a browser-call attempt was placed, until either
  // the shared phone context confirms it connected OR the stall timeout
  // below fires — never read directly inside the timeout callback via
  // `state` (a stale closure risk), always via this ref instead.
  const waitingForBrowserConnectRef = useRef(false);
  const stallTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set only when a browser-call attempt genuinely stalled (placeCall()
  // reported success but the call never actually connected within the
  // timeout) — offers an EXPLICIT button to retry via the phone-callback
  // fallback. Deliberately never auto-triggered: a silent no-op inside
  // Zadarma's own library (a real, documented behavior — see
  // ZadarmaPhoneProvider's module comment) must never silently become a
  // real, billable callback without the agent choosing it.
  const [offerCallbackFallback, setOfferCallbackFallback] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (stallTimeoutRef.current) clearTimeout(stallTimeoutRef.current);
    };
  }, []);

  function startTimerIfNeeded() {
    if (intervalRef.current) return;
    setElapsed(0);
    intervalRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  }

  function stopTimer() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  }

  // Only reflects the shared phone's state while THIS workspace is the one
  // that placed the call (viaBrowser) — an unrelated incoming call for a
  // different contact is shown by the global ZadarmaCallBar instead, never
  // mistakenly attributed to whichever contact happens to be selected here.
  useEffect(() => {
    if (!viaBrowser || !phone) return;
    if (phone.status === "on_call" || phone.status === "incoming") {
      waitingForBrowserConnectRef.current = false;
      if (stallTimeoutRef.current) {
        clearTimeout(stallTimeoutRef.current);
        stallTimeoutRef.current = null;
      }
      setState("in_call");
      startTimerIfNeeded();
    } else if (phone.status === "ready" && (state === "in_call" || state === "requesting")) {
      stopTimer();
      setState("ended");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-runs on the phone status transition, not every render
  }, [phone?.status, viaBrowser]);

  const STALL_TIMEOUT_MS = 15000;

  /** `.call()` can report success (placeCall() returns true) while the
   * underlying library silently does nothing — a real, documented Zadarma
   * behavior when the session isn't truly registered yet, confirmed during
   * this project's research. Without this, that leaves the agent staring
   * at "Calling in browser..." forever, with no error and no way out. This
   * fires once, STALL_TIMEOUT_MS after a browser-call attempt, and only
   * acts if the call never actually connected in that window. */
  function armStallTimeout() {
    if (stallTimeoutRef.current) clearTimeout(stallTimeoutRef.current);
    waitingForBrowserConnectRef.current = true;
    stallTimeoutRef.current = setTimeout(() => {
      if (!waitingForBrowserConnectRef.current) return; // already connected or ended — nothing to do
      waitingForBrowserConnectRef.current = false;
      setError(
        t(
          "The browser call didn't connect. This can happen if the calling session wasn't fully ready yet.",
          "La llamada por navegador no se conectó. Esto puede ocurrir si la sesión de llamadas aún no estaba completamente lista."
        )
      );
      setOfferCallbackFallback(true);
      setViaBrowser(false);
      setState("idle");
    }, STALL_TIMEOUT_MS);
  }

  /** The explicit, agent-chosen action after a detected stall — never
   * triggered automatically. Re-runs the same server-side authorization
   * gate (authorizeCallAction) rather than reusing a result from moments
   * earlier, so this stays correct even if something about the agent's
   * access changed in between. */
  async function handleFallbackToCallback() {
    setOfferCallbackFallback(false);
    setError(undefined);
    setState("requesting");
    const auth = await authorizeCallAction(contact.id);
    if (auth.error || !auth.phone) {
      setError(auth.error ?? "Could not verify you're allowed to call this contact.");
      setState("idle");
      return;
    }
    setViaBrowser(false);
    const result = await initiateCallAction(contact.id);
    if (result.error) {
      setError(result.error);
      setState("idle");
      return;
    }
    startTimerIfNeeded();
    setState("in_call");
  }

  const assignedNumber = callingStatus?.number ?? null;
  const browserCallReady = phone?.status === "ready";
  const canCall = zadarmaConfigured && !!assignedNumber && !!contact.phone;

  async function handleStartCall() {
    setError(undefined);
    setOfferCallbackFallback(false);
    setState("requesting");

    // Server-side authorization gate, run BEFORE either calling path —
    // placeCall() below is pure client-side with no server round-trip of
    // its own, so without this call, company access and lead assignment
    // would never be checked at all for a browser call (only for the
    // requestCallback fallback). A failure here stops the attempt
    // entirely; it never falls back to the other calling mechanism, since
    // a failed authorization means this agent shouldn't be calling this
    // contact via EITHER path. Also returns the contact's own phone
    // number — the browser always dials what the server authorized, never
    // a client-held value.
    const auth = await authorizeCallAction(contact.id);
    if (auth.error || !auth.phone) {
      setError(auth.error ?? "Could not verify you're allowed to call this contact.");
      setState("idle");
      return;
    }

    // Browser calling first, when it's actually ready — falls back to the
    // existing callback flow for every other reason (not ready, no
    // extension, provisioning disabled, etc.), automatically and silently
    // — same button either way, same authorization already passed above.
    if (phone && browserCallReady) {
      const placed = phone.placeCall(auth.phone);
      if (placed) {
        setViaBrowser(true);
        armStallTimeout();
        return;
      }
    }

    setViaBrowser(false);
    const result = await initiateCallAction(contact.id);
    if (result.error) {
      setError(result.error);
      setState("idle");
      return;
    }
    startTimerIfNeeded();
    setState("in_call");
  }

  function handleEndCall() {
    waitingForBrowserConnectRef.current = false;
    if (stallTimeoutRef.current) {
      clearTimeout(stallTimeoutRef.current);
      stallTimeoutRef.current = null;
    }
    if (viaBrowser && phone) {
      phone.hangUp();
      // The effect above moves this to "ended" once the shared phone
      // context confirms it — avoids a UI that says "ended" a beat before
      // the real call actually stops.
      return;
    }
    stopTimer();
    setState("ended");
  }

  const statusLabel =
    state === "idle"
      ? t("Ready to call", "Listo para llamar")
      : state === "requesting"
        ? viaBrowser
          ? t("Calling in browser...", "Llamando desde el navegador...")
          : t("Requesting callback...", "Solicitando llamada...")
        : state === "in_call"
          ? t("Call in progress", "Llamada en curso")
          : t("Call ended — log the result below", "Llamada finalizada — registra el resultado abajo");

  const statusDotClass = state === "in_call" ? "bg-success animate-pulse" : state === "requesting" ? "bg-warning" : state === "ended" ? "bg-text-tertiary" : "bg-border";

  return (
    <Card className="flex flex-col items-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar name={contact.name} size={56} />
        <p className="text-[18px] font-semibold text-text-primary">{contact.name}</p>
        <p className="text-[14px] text-text-secondary">{contact.phone}</p>
        <StageBadge stage={contact.stageKey} />
      </div>

      <div className="flex w-full flex-col items-center gap-1 rounded-xl border border-border bg-surface-muted px-4 py-3">
        <p className="text-[11px] font-semibold tracking-wide text-text-tertiary">{t("CALLING FROM", "LLAMANDO DESDE")}</p>
        {assignedNumber ? (
          <>
            <p className="text-[14px] font-semibold text-text-primary">{assignedNumber}</p>
            <Badge tone={browserCallReady ? "green" : "gray"}>
              {browserCallReady ? t("Browser call", "Llamada por navegador") : t("Phone callback", "Llamada de retorno")}
            </Badge>
          </>
        ) : (
          <p className="text-[13px] font-medium text-danger">
            {zadarmaConfigured
              ? t("No number assigned to this company", "Sin número asignado a esta empresa")
              : t("Zadarma not configured", "Zadarma no configurado")}
          </p>
        )}
      </div>

      {!canCall && (
        <div className="flex items-start gap-2 rounded-xl border border-warning-100 bg-warning-50 px-3.5 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-700" />
          <p className="text-[12.5px] text-warning-700">
            {!contact.phone
              ? t("This contact has no phone number.", "Este contacto no tiene número de teléfono.")
              : !zadarmaConfigured
                ? t("Calling isn't available yet — Zadarma isn't configured.", "Las llamadas no están disponibles aún — Zadarma no está configurado.")
                : t("A Superuser must buy/assign a Zadarma number to this company in Configuración before calls can be made.", "Un Superusuario debe comprar/asignar un número de Zadarma a esta empresa en Configuración antes de poder llamar.")}
          </p>
        </div>
      )}

      <div className="flex flex-col items-center gap-3">
        {state === "in_call" ? (
          <button
            onClick={handleEndCall}
            aria-label={t("End call", "Finalizar llamada")}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-danger text-white shadow-lg shadow-danger/30 transition-transform hover:scale-105"
          >
            <PhoneOff className="h-6 w-6" />
          </button>
        ) : (
          <button
            onClick={handleStartCall}
            disabled={!canCall || state === "requesting"}
            aria-label={t("Call", "Llamar")}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-sidebar-active text-white shadow-lg shadow-brand/30 transition-transform hover:scale-105 hover:bg-[color-mix(in_srgb,var(--sidebar-active)_82%,black)] disabled:opacity-40 disabled:hover:scale-100"
          >
            <PhoneCall className="h-6 w-6" />
          </button>
        )}

        <div className="flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", statusDotClass)} aria-hidden />
          <span className="text-[12.5px] text-text-secondary">{statusLabel}</span>
        </div>

        {(state === "in_call" || state === "ended") && (
          <p className="font-mono text-[22px] font-semibold tabular-nums text-text-primary">{formatElapsed(elapsed)}</p>
        )}

        {error && <p className="max-w-[260px] text-center text-[12.5px] text-danger">{error}</p>}

        {offerCallbackFallback && (
          <Button size="sm" variant="outline" onClick={handleFallbackToCallback}>
            {t("Try phone callback instead", "Probar llamada de retorno en su lugar")}
          </Button>
        )}
      </div>

      <p className="text-center text-[11px] text-text-tertiary">
        {viaBrowser
          ? t(
              "Timer reflects the browser call's real state.",
              "El cronómetro refleja el estado real de la llamada por navegador."
            )
          : t(
              "Timer is tracked locally by your browser — this callback mode has no live call events from Zadarma.",
              "El cronómetro se mide localmente en tu navegador — este modo de retorno de llamada no tiene eventos en vivo de Zadarma."
            )}
      </p>
    </Card>
  );
}

/** Right column — contact context: recent activity, the call-result form
 * (status/duration/outcome/notes), and this contact's own recent calls.
 * Functionally identical to the original combined panel's second half;
 * split out only so the layout matches the requested 3-column design. */
function ContactDetailPanel({
  contact,
  stages,
  activities,
  calls,
  statusLabels,
  stageLabels,
  loadingDetail,
  onSaved,
}: {
  contact: ContactWithJoins;
  stages: PipelineStage[];
  activities: ActivityWithAuthor[];
  calls: Call[];
  statusLabels: Record<CallStatus, string>;
  stageLabels: Record<Stage, string>;
  onSaved: () => void;
  loadingDetail: boolean;
}) {
  const { t, language } = useLanguage();

  const [status, setStatus] = useState<CallStatus>("COMPLETED");
  const [duration, setDuration] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [pipelineStageId, setPipelineStageId] = useState(contact.pipelineStageId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

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
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3 p-5">
        <CardTitle>{t("Activity history", "Historial de actividad")}</CardTitle>
        {loadingDetail ? (
          <p className="text-center text-[13px] text-text-tertiary">{t("Loading...", "Cargando...")}</p>
        ) : activities.length === 0 ? (
          <p className="text-center text-[13px] text-text-tertiary">{t("No activity yet.", "Aún no hay actividad.")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {activities.slice(0, 5).map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-text-primary">
                    {getActivityLabel(a, language)}
                    {a.outcome ? ` · ${a.type === "STATUS_CHANGE" ? stageLabels[a.outcome as Stage] ?? a.outcome : a.outcome}` : ""}
                  </p>
                  <p className="text-[11.5px] text-text-secondary">{a.authorName}</p>
                </div>
                <span className="shrink-0 text-[11.5px] text-text-tertiary">{formatRelativeTime(a.createdAt, language)}</span>
              </div>
            ))}
          </div>
        )}
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
              {t("THIS CONTACT'S RECENT CALLS", "LLAMADAS RECIENTES DE ESTE CONTACTO")}
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
    </div>
  );
}

/** Bottom section — recent call history across every company the viewer is
 * allowed to see (not just the selected contact), using the already-existing
 * callsRepo.findManyByCompanyIds via services/calls.ts's
 * listCallsForCurrentUser — previously fetched but never shown on this page. */
function CompanyCallHistory({ history, statusLabels }: { history: CallWithContact[]; statusLabels: Record<CallStatus, string> }) {
  const { t, language } = useLanguage();

  // CallWithContact doesn't carry companyName, only companyId — filtering by
  // the active company selector here would need a companyId lookup the
  // queue already has for contacts, not calls. Keeping this section
  // unfiltered (every allowed company) is deliberate: it's the one place on
  // this page meant to give a cross-company view of recent call activity,
  // matching the "recent call history" requirement rather than duplicating
  // the already-filtered queue/workspace above.
  const rows = history.slice(0, 15);

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <CardTitle>{t("Recent call history", "Historial reciente de llamadas")}</CardTitle>
        <Badge tone="gray">{t("All allowed companies", "Todas las empresas permitidas")}</Badge>
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-text-tertiary">{t("No calls logged yet.", "Aún no hay llamadas registradas.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-[11px] font-semibold tracking-wide text-text-tertiary">
                <th className="py-2 pr-4">{t("CONTACT", "CONTACTO")}</th>
                <th className="py-2 pr-4">{t("PHONE", "TELÉFONO")}</th>
                <th className="py-2 pr-4">{t("STATUS", "ESTADO")}</th>
                <th className="py-2 pr-4">{t("DURATION", "DURACIÓN")}</th>
                <th className="py-2 pr-4">{t("OUTCOME", "RESULTADO")}</th>
                <th className="py-2">{t("WHEN", "CUÁNDO")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-4 font-medium text-text-primary">{c.contactName}</td>
                  <td className="py-2 pr-4 text-text-secondary">{c.phoneNumber}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={c.status === "COMPLETED" ? "green" : c.status === "FAILED" ? "red" : "amber"}>
                      {statusLabels[c.status as CallStatus] ?? c.status}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4 text-text-secondary">{c.durationSeconds != null ? formatElapsed(c.durationSeconds) : "—"}</td>
                  <td className="max-w-[220px] truncate py-2 pr-4 text-text-secondary">{c.outcome ?? "—"}</td>
                  <td className="py-2 text-text-tertiary">{formatDateTime(c.startedAt, language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
