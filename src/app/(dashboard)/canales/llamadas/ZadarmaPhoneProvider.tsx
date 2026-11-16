"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getMyZadarmaWebrtcCredentialsAction } from "./actions";

/** Shared browser-calling state for the whole Llamadas page — replaces the
 * old page-level, disconnected `BrowserCallingPanel`. Every piece that
 * needs to know "is browser calling ready, and what's happening right now"
 * (the lead's Call button, the call bar, the incoming-call banner) reads
 * from this ONE context instead of each re-deriving its own state, which is
 * exactly what caused the original disconnect between the Call button and
 * the floating widget.
 *
 * IMPORTANT — stated plainly, not glossed over. This file has been revised
 * twice against REAL, live manual testing (2026-11-14), not just static
 * code reading:
 *
 * 1. `zadarmaWidgetFn` alone does NOT register the browser with Zadarma —
 *    confirmed live: no WebSocket ever opened until `window.zdrmWPhI.reg(sip)`
 *    was called explicitly (found via static analysis of Zadarma's own
 *    widget-api.min.js, then CONFIRMED by manually running it in a live
 *    browser console and watching a real WebSocket appear). This file now
 *    calls `.reg()` itself.
 *
 * 2. Even after `.reg()`, Zadarma's PBX-side `is_online` status endpoint
 *    (`GET /v1/pbx/internal/<sip>/status/`) stayed `false` in testing. This
 *    may mean that endpoint simply doesn't reflect WebRTC widget sessions
 *    at all (it may only track classic SIP hardware/softphone
 *    registrations) — this was NOT confirmed either way. So this file
 *    cannot and does not rely on that external status check; "ready" here
 *    is necessarily a client-side-only confirmation, described honestly
 *    below as a heuristic, not a certainty.
 *
 * 3. Zadarma's widget DOES expose real per-call status callbacks
 *    (`getStatusMessage(msg, params)` with 'incoming'/'confirmed'/
 *    'canceled'/'rejected'/'busy'/'outgoing', plus a separate
 *    `callbackEndCall(response)`) — confirmed via static analysis of the
 *    real loader-phone-fn.js. These are unconditionally-invoked functions
 *    on the options object passed into the underlying widget library (no
 *    existence check before calling), so overriding them is safe. This is
 *    a FAR more reliable signal for "a call is genuinely connected" than
 *    polling `window.zdrmWebPhone.talking`, which flips to 1 optimistically
 *    at DIAL time, not at CONNECT time — that mismatch is almost certainly
 *    why the in-app timer previously started before any real ringing could
 *    have happened. `'confirmed'` is now the authoritative "call is really
 *    connected" signal; polling `talking` is kept only as a delayed,
 *    logged-as-a-warning fallback in case the event hooks never fire for
 *    some unforeseen reason.
 *
 * No registration-SUCCESS or registration-FAILURE callback was found
 * anywhere in Zadarma's public widget code — only call-state callbacks
 * exist. So "ready" is still ultimately a best-effort read of
 * `unreg_flag`, just a meaningfully stricter one than before (gated behind
 * an explicit `.reg()` call, require several consecutive confirming polls,
 * and a timeout that surfaces a real error instead of hanging forever). */

export type ZadarmaPhoneStatus =
  | "checking" // haven't asked the server for a credential yet
  | "not_leader" // another open tab already holds the live registration
  | "unavailable" // no credential, widget/registration failure, or registration timeout — see unavailableReason
  | "mic_denied" // credential obtained, but getUserMedia rejected — see unavailableReason for the REAL browser-reported reason (not necessarily an actual permission denial; could be no device, device busy, etc.)
  | "connecting" // credential obtained, widget scripts loading / registering — not yet confirmed
  | "ready" // registration heuristically confirmed, idle, can place/receive calls
  | "on_call" // a call is genuinely connected — see module comment on 'confirmed'
  | "incoming"; // a call is ringing, not yet answered

export type ZadarmaPhoneContextValue = {
  status: ZadarmaPhoneStatus;
  unavailableReason?: string;
  incomingNumber: string | null;
  muted: boolean;
  /** Attempts to place a call through the browser widget. Returns false
   * (without throwing) if the phone isn't in a state that can actually
   * place one right now — callers (the lead's Call button) use this to
   * decide whether to fall back to the existing requestCallback flow. */
  placeCall: (number: string) => boolean;
  answerCall: () => void;
  rejectCall: () => void;
  hangUp: () => void;
  toggleMute: () => void;
};

const ZadarmaPhoneContext = createContext<ZadarmaPhoneContextValue | null>(null);

/** Returns null when rendered outside the provider — callers (e.g. the
 * Call button) must treat that the same as "browser calling unavailable",
 * never throw, since the provider is deliberately only mounted on the
 * Llamadas page. */
export function useZadarmaPhone(): ZadarmaPhoneContextValue | null {
  return useContext(ZadarmaPhoneContext);
}

/** Pure mapping from Zadarma's real getStatusMessage event names to what
 * this provider does — exported so this specific, meaningful piece of
 * logic has real test coverage, same idiom as this codebase's other
 * provider-event mapping functions (e.g. zadarmaCallEvents.ts's
 * mapDispositionToStatus). 'outgoing' and anything unrecognized map to
 * `null` — never guessed into a state change. */
export function mapZadarmaCallStatusMessage(msg: string): "incoming" | "confirmed" | "ended" | null {
  switch (msg) {
    case "incoming":
      return "incoming";
    case "confirmed":
      return "confirmed";
    case "canceled":
    case "rejected":
    case "busy":
      return "ended";
    default:
      return null;
  }
}

const LOG_PREFIX = "[zadarma-widget]";
/** Structured diagnostic logging for the whole widget lifecycle — every
 * call site below passes only non-secret values (sip login, event names,
 * booleans, timestamps). The WebRTC key and any SIP password are NEVER
 * passed to this function anywhere in this file — confirmed by reading
 * every call site below. */
function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(LOG_PREFIX, ...args);
}

declare global {
  interface Window {
    zadarmaWidgetFn?: (key: string, sip: string, shape: string, lang: string, fixed: boolean, position: Record<string, string>) => void;
    // Confirmed-real fields on the underlying phone-state object (see
    // module comment) — typed loosely (unknown) since nothing beyond these
    // two fields was ever confirmed to exist.
    zdrmWebPhone?: { unreg_flag?: boolean; talking?: number; [key: string]: unknown };
    // Best-effort wrapper/interface instance (see module comment) — every
    // access is optional-chained and wrapped in try/catch, never assumed
    // present.
    zdrmWPhI?: {
      // Confirmed REQUIRED and REAL via live manual testing (2026-11-14):
      // zadarmaWidgetFn() alone does NOT register the browser with Zadarma
      // — no WebSocket to any Zadarma domain ever opens without this being
      // called explicitly.
      reg?: (sip: string) => void;
      call?: (number: string) => void;
      answer?: () => void;
      cancel?: () => void;
      finishCall?: () => void;
      micSwitch?: (state: "on" | "off") => void;
      ringing?: (...args: unknown[]) => void;
      setCallingNumber?: (number: string) => void;
      // Confirmed real via static analysis of loader-phone-fn.js — part of
      // the options object the widget library is configured with, called
      // unconditionally (no existence check) on every call-state change.
      getStatusMessage?: (msg: string, parameters: unknown) => void;
      callbackEndCall?: (response: unknown) => void;
      // Internal marker this file sets once it has wrapped the callbacks
      // above, so a later re-init (e.g. after a detected registration
      // drop) never wraps them a second time, which would otherwise fire
      // our own React state updates twice per real event.
      __growthOnWired?: boolean;
      [key: string]: unknown;
    };
  }
}

const ZADARMA_WIDGET_LIB_URL = "https://my.zadarma.com/webphoneWebRTCWidget/v8/js/loader-phone-lib.js";
const ZADARMA_WIDGET_FN_URL = "https://my.zadarma.com/webphoneWebRTCWidget/v8/js/loader-phone-fn.js";
const POLL_INTERVAL_MS = 500;
/** How many consecutive polls must read unreg_flag===false before "ready"
 * is ever displayed — a single reading is too easy to confuse with the
 * field's unconfirmed default/initial value (see module comment point 2).
 * 3 ticks at 500ms = 1.5s of sustained agreement. */
const REGISTRATION_SUSTAIN_TICKS = 3;
/** If registration isn't confirmed within this long after calling .reg(),
 * stop waiting and surface a real, specific error instead of leaving the
 * call bar stuck on "Setting up browser calling..." forever. */
const REGISTRATION_TIMEOUT_MS = 10000;
/** How long `talking` must read true, continuously, before the FALLBACK
 * path (used only if the 'confirmed' event never fires) treats a call as
 * connected — deliberately longer than a single tick so a call that's
 * merely dialing (talking flips to 1 optimistically at dial-time, per the
 * module comment) isn't mistaken for one that's actually connected. */
const TALKING_FALLBACK_SUSTAIN_MS = 2000;

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

/** Zadarma's own default widget UI (drawn automatically as a side effect of
 * `zadarmaWidgetFn` — there is no confirmed, documented way to initialize
 * the underlying calling engine without it) gets visually hidden so this
 * page's own GrowthOn-styled call bar is the only calling UI the agent
 * sees.
 *
 * An off-screen-positioning variant was tried (2026-11-14) as an unproven
 * precaution against a theoretical interference with Zadarma's internal
 * element handling — but live testing immediately afterward showed the
 * widget API (`zdrmWPhI.reg`) failing to ever become available at all,
 * where it previously had. That correlation is strong enough to revert
 * immediately rather than keep an unconfirmed change that may have
 * actively broken initialization — reverted back to this original,
 * previously-working rule. Requirement "does hiding interfere with
 * calling" (#7) remains genuinely open; answering it properly needs a
 * controlled live test (hidden vs. fully visible, nothing else changed),
 * not a speculative CSS swap bundled with other fixes. */
function hideDefaultWidgetUi() {
  if (document.getElementById("zadarma-widget-hide-style")) return;
  const style = document.createElement("style");
  style.id = "zadarma-widget-hide-style";
  style.textContent = `[id^="zdrm-"], [class*="zdrm"] { position: absolute !important; width: 1px !important; height: 1px !important; overflow: hidden !important; opacity: 0 !important; pointer-events: none !important; }`;
  document.head.appendChild(style);
}

/** `zadarmaWidgetFn` bootstraps the widget's internal objects
 * asynchronously (fetching labels/SIP info internally per earlier static
 * analysis) — `window.zdrmWPhI.reg` is not guaranteed to exist the instant
 * `zadarmaWidgetFn` returns. Polls briefly rather than assuming a fixed
 * delay, since the real bootstrap time was never measured/confirmed.
 *
 * Generous 20s timeout (raised from an initial 10s guess after that first
 * value timed out in live testing for a reason never isolated — could be
 * genuinely slow bootstrap on Zadarma's side, could be something else;
 * widening it is the safe, no-downside first step before assuming a code
 * bug). Logs periodically WHILE waiting (not just on final failure) and,
 * on timeout, logs exactly what `window.zdrmWPhI` actually contains (or
 * confirms it doesn't exist at all) — this is the detail needed to tell
 * "the object never got created" apart from "it exists but something else
 * is different about it," without needing DevTools. */
function waitForRegMethod(timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let lastLoggedSecond = -1;
    const check = () => {
      if (window.zdrmWPhI?.reg) {
        log("zdrmWPhI.reg became available", { waitedMs: Date.now() - start });
        resolve();
        return;
      }
      const elapsed = Date.now() - start;
      const elapsedSeconds = Math.floor(elapsed / 2000);
      if (elapsedSeconds !== lastLoggedSecond) {
        lastLoggedSecond = elapsedSeconds;
        log("still waiting for zdrmWPhI.reg...", {
          elapsedMs: elapsed,
          zdrmWPhIExists: typeof window.zdrmWPhI !== "undefined",
          zdrmWPhIKeys: window.zdrmWPhI ? Object.keys(window.zdrmWPhI) : null,
          zadarmaWidgetFnExists: typeof window.zadarmaWidgetFn === "function",
        });
      }
      if (elapsed > timeoutMs) {
        log("timed out waiting for zdrmWPhI.reg", {
          elapsedMs: elapsed,
          zdrmWPhIExists: typeof window.zdrmWPhI !== "undefined",
          zdrmWPhIKeys: window.zdrmWPhI ? Object.keys(window.zdrmWPhI) : null,
          zdrmWebPhoneExists: typeof window.zdrmWebPhone !== "undefined",
        });
        reject(new Error("Zadarma's widget API didn't finish initializing in time."));
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}

/** Loads the widget scripts and invokes zadarmaWidgetFn exactly once per
 * page session (module-level promise — see original design rationale).
 * Deliberately does NOT call `.reg()` itself: registration must be
 * re-attempted every time `initializePhone` runs (including after a
 * detected drop/reconnect), even though the scripts themselves only need
 * loading once — see initializePhone for where `.reg()` is actually
 * called.
 *
 * On failure, resets the module-level cache back to null (a real bug
 * fixed here: previously, once this rejected a single time, the SAME
 * rejected promise was returned forever afterward for the rest of the
 * page's lifetime — the `if (!widgetLoadPromise)` guard treats a
 * rejected-but-defined promise as "already loaded" and never retries,
 * silently preventing any recovery short of a full page reload). */
let widgetLoadPromise: Promise<void> | null = null;
function ensureWidgetScriptsLoaded(sip: string, key: string, lang: string): Promise<void> {
  if (!widgetLoadPromise) {
    log("loading widget scripts", { sip });
    widgetLoadPromise = loadScriptOnce(ZADARMA_WIDGET_LIB_URL)
      .then(() => loadScriptOnce(ZADARMA_WIDGET_FN_URL))
      .then(() => {
        // A script tag firing `onload` only confirms the HTTP request
        // completed — NOT that it actually defined `zadarmaWidgetFn` (a
        // blocked/CORS-mangled/ad-blocker-altered response can still
        // return 200 with empty or different content, which doesn't fire
        // `onerror`). Logging this distinctly from "scripts loaded" lets
        // that specific failure mode be told apart from "the function
        // exists but its own internal bootstrap never finishes."
        log("widget scripts loaded, invoking zadarmaWidgetFn", { sip, zadarmaWidgetFnExists: typeof window.zadarmaWidgetFn === "function" });
        try {
          window.zadarmaWidgetFn?.(key, sip, "square", lang, true, { right: "16px", bottom: "16px" });
        } catch (e) {
          log("zadarmaWidgetFn threw synchronously", { error: e instanceof Error ? e.message : String(e) });
          throw e;
        }
        hideDefaultWidgetUi();
      })
      .then(() => waitForRegMethod())
      .then(() => {
        log("widget API ready (zdrmWPhI.reg exists)");
      })
      .catch((e) => {
        widgetLoadPromise = null;
        throw e;
      });
  }
  return widgetLoadPromise;
}

export function ZadarmaPhoneProvider({
  children,
  lang,
  userId,
}: {
  children: React.ReactNode;
  lang: string;
  /** Scopes the multi-tab leader-election lock to THIS specific agent.
   * Without this, two different agents sharing one browser profile (a
   * shared/kiosk machine, or separate logins in the same browser) would
   * contend for the exact same lock name — the second agent's tab would
   * see it "already held" and never register their OWN extension, even
   * though the holder is a completely different person's session, not a
   * second tab of their own. */
  userId: string;
}) {
  const lockName = `zadarma-phone-leader-${userId}`;
  const [status, setStatus] = useState<ZadarmaPhoneStatus>("checking");
  const [unavailableReason, setUnavailableReason] = useState<string | undefined>();
  const [incomingNumber, setIncomingNumber] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  const wasTalkingRef = useRef(false);
  const talkingSinceRef = useRef<number | null>(null);
  const wasRegisteredRef = useRef(false);
  const incomingNumberRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Registration-confirmation bookkeeping — see REGISTRATION_SUSTAIN_TICKS/
  // REGISTRATION_TIMEOUT_MS above for why this exists instead of trusting
  // a single poll reading.
  const regCalledAtRef = useRef<number | null>(null);
  const registrationConfirmedRef = useRef(false);
  const sustainedTrueCountRef = useRef(0);

  // Set true the instant a 'confirmed' event arrives, false again once the
  // call ends — lets the talking-poll fallback know whether the authoritative
  // event already handled this call, so it never double-fires a transition.
  const confirmedByEventRef = useRef(false);

  useEffect(() => {
    incomingNumberRef.current = incomingNumber;
  }, [incomingNumber]);

  // --- Multi-tab leader election (Web Locks API) ------------------------
  // Only the tab that actually holds this lock mints a credential and
  // registers a live SIP session — prevents two open tabs from fighting
  // over the same extension's registration. If a browser doesn't support
  // the Locks API (very old browsers), every tab falls back to acting as
  // its own leader — a known, accepted degradation, not a crash.
  useEffect(() => {
    let active = true;
    let releaseLock: (() => void) | undefined;

    async function becomeLeaderThenInit() {
      if (!("locks" in navigator)) {
        // No Locks API support (very old browser) — every tab acts as its
        // own leader. Accepted degradation, not a crash.
        if (active) initializePhone();
        return;
      }

      // Exactly ONE real lock request for this tab's whole lifetime — never
      // two separate acquire attempts, which would leave a race window for
      // another tab to grab the lock in between. If it doesn't resolve
      // almost immediately, another tab is already holding it; show that
      // distinctly while this request keeps waiting in the background so
      // this tab is promoted automatically the moment that tab closes.
      let acquired = false;
      const notLeaderTimer = setTimeout(() => {
        if (active && !acquired) setStatus("not_leader");
      }, 150);

      await navigator.locks.request(lockName, async () => {
        clearTimeout(notLeaderTimer);
        acquired = true;
        if (!active) return;
        initializePhone();
        await new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
      });
    }

    becomeLeaderThenInit();

    return () => {
      active = false;
      releaseLock?.();
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per page session
  }, []);

  async function initializePhone() {
    setStatus("checking");
    setUnavailableReason(undefined);
    log("initializePhone: fetching credentials");
    const result = await getMyZadarmaWebrtcCredentialsAction();
    if (!result.ok) {
      log("credential fetch failed", { reason: result.reason });
      setStatus("unavailable");
      setUnavailableReason(result.message);
      return;
    }
    log("credential fetch succeeded", { sip: result.sip });

    // Pre-flight the microphone BEFORE registering — never let a missing
    // permission surface as a silent, confusing failure deep inside
    // Zadarma's own library.
    //
    // getUserMedia rejects with a real, specific DOMException name — never
    // just "denied". A real production report traced a call bar saying
    // "access was denied" while the browser's own site-permission icon
    // showed mic access allowed; the actual failure was something else
    // entirely (no device connected, device already in use by another
    // app, or an OS-level privacy toggle blocking the browser, none of
    // which "denied" accurately describes). Surfacing e.name/e.message
    // here — never fabricating a generic "denied" label — is what lets a
    // future case like that be diagnosed from the call bar alone, no
    // DevTools needed.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      log("microphone pre-flight succeeded");
    } catch (e) {
      const name = e instanceof DOMException ? e.name : undefined;
      const detail = e instanceof Error ? e.message : String(e);
      log("microphone pre-flight failed", { name, detail });
      setUnavailableReason(name ? `${name}: ${detail}` : detail);
      setStatus("mic_denied");
      return;
    }

    setStatus("connecting");
    try {
      await ensureWidgetScriptsLoaded(result.sip, result.key, lang);
    } catch (e) {
      log("widget script loading failed", { error: e instanceof Error ? e.message : String(e) });
      setStatus("unavailable");
      setUnavailableReason(e instanceof Error ? e.message : "Failed to load the Zadarma calling widget.");
      return;
    }

    wireEventCallbacks();

    // The confirmed-missing step (see module comment point 1): without
    // this explicit call, no WebSocket to Zadarma ever opens and the
    // browser never actually registers, regardless of what zadarmaWidgetFn
    // alone appears to set up. Re-run every time initializePhone runs
    // (including after a detected drop), never cached.
    registrationConfirmedRef.current = false;
    sustainedTrueCountRef.current = 0;
    regCalledAtRef.current = Date.now();
    log("calling zdrmWPhI.reg()", { sip: result.sip });
    try {
      window.zdrmWPhI?.reg?.(result.sip);
    } catch (e) {
      log("zdrmWPhI.reg() threw synchronously", { error: e instanceof Error ? e.message : String(e) });
      setStatus("unavailable");
      setUnavailableReason("Zadarma's widget rejected the registration attempt.");
      return;
    }

    startPolling();
  }

  /** Wraps the real, unconditionally-invoked getStatusMessage/
   * callbackEndCall functions Zadarma's widget already calls internally —
   * confirmed via static analysis of loader-phone-fn.js (see module
   * comment point 3). Guarded by a marker property so re-running
   * initializePhone (e.g. after a detected drop) never wraps twice. */
  function wireEventCallbacks() {
    const iface = window.zdrmWPhI;
    if (!iface || iface.__growthOnWired) return;
    iface.__growthOnWired = true;

    try {
      if (iface.setCallingNumber) {
        const original = iface.setCallingNumber.bind(iface);
        iface.setCallingNumber = (number: string) => {
          setIncomingNumber(number);
          original(number);
        };
      }
    } catch (e) {
      log("failed to wrap setCallingNumber (best-effort, non-fatal)", { error: e instanceof Error ? e.message : String(e) });
    }

    try {
      if (iface.getStatusMessage) {
        const original = iface.getStatusMessage.bind(iface);
        iface.getStatusMessage = (msg: string, parameters: unknown) => {
          log("getStatusMessage event", { msg });
          const action = mapZadarmaCallStatusMessage(msg);
          if (action === "incoming") {
            setStatus("incoming");
          } else if (action === "confirmed") {
            confirmedByEventRef.current = true;
            setStatus("on_call");
          } else if (action === "ended") {
            confirmedByEventRef.current = false;
            setIncomingNumber(null);
            setMuted(false);
            setStatus((prev) => (prev === "ready" ? prev : "ready"));
          }
          original(msg, parameters);
        };
      }
    } catch (e) {
      log("failed to wrap getStatusMessage (falling back to talking-poll only)", { error: e instanceof Error ? e.message : String(e) });
    }

    try {
      if (iface.callbackEndCall) {
        const original = iface.callbackEndCall.bind(iface);
        iface.callbackEndCall = (response: unknown) => {
          log("callbackEndCall event");
          confirmedByEventRef.current = false;
          setIncomingNumber(null);
          setMuted(false);
          setStatus("ready");
          original(response);
        };
      }
    } catch (e) {
      log("failed to wrap callbackEndCall (best-effort, non-fatal)", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Runs on an interval, so it must never read component state/props
   * directly (stale-closure risk) — only refs (kept current via the effect
   * above) and functional setState updates. Clears any previously-running
   * interval first so re-initializing (e.g. after a detected drop) can
   * never stack a second, leaked interval on top of the first. */
  function startPolling() {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(() => {
      const phone = window.zdrmWebPhone;
      if (!phone) return;

      const registered = phone.unreg_flag === false;

      // Phase 1: registration not yet confirmed. Require several
      // consecutive agreeing polls before ever showing "ready" — see
      // REGISTRATION_SUSTAIN_TICKS. A single reading of false is too easy
      // to confuse with this field's unconfirmed default value (module
      // comment point 2).
      if (!registrationConfirmedRef.current) {
        if (registered) {
          sustainedTrueCountRef.current += 1;
          if (sustainedTrueCountRef.current >= REGISTRATION_SUSTAIN_TICKS) {
            registrationConfirmedRef.current = true;
            wasRegisteredRef.current = true;
            log("registration heuristically confirmed", { sustainedTicks: sustainedTrueCountRef.current });
            setStatus("ready");
          }
        } else {
          sustainedTrueCountRef.current = 0;
        }

        if (regCalledAtRef.current && Date.now() - regCalledAtRef.current > REGISTRATION_TIMEOUT_MS) {
          log("registration not confirmed within timeout", { elapsedMs: Date.now() - regCalledAtRef.current });
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setStatus("unavailable");
          setUnavailableReason(
            "Zadarma didn't confirm SIP registration in time. This can happen even when the connection looks fine from the browser's side — check the extension's online status in Zadarma's dashboard, or try reloading."
          );
        }
        return;
      }

      // Phase 2: registration was confirmed at least once — watch for a
      // real drop (re-initializes from scratch rather than leaving a
      // stale "ready" shown).
      if (!registered) {
        if (wasRegisteredRef.current) {
          log("registration drop detected — re-initializing");
          wasRegisteredRef.current = false;
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          widgetLoadPromise = null; // force a fresh script/credential cycle
          initializePhone();
        }
        return;
      }

      // Phase 3: call-state FALLBACK only — the getStatusMessage/
      // callbackEndCall overrides above are the authoritative source for
      // call state (module comment point 3). This only acts if a call
      // appears active (`talking`) but the event hooks never fired —
      // e.g. because wiring them failed for some unforeseen reason — and
      // even then only after a sustained delay, never on the very first
      // tick, so a call that's merely dialing (talking flips to 1
      // optimistically at dial-time) is never mistaken for one that's
      // actually connected.
      const talking = phone.talking === 1;
      if (talking && !confirmedByEventRef.current) {
        if (talkingSinceRef.current === null) talkingSinceRef.current = Date.now();
        if (Date.now() - talkingSinceRef.current >= TALKING_FALLBACK_SUSTAIN_MS) {
          log("call-state fallback triggered — 'confirmed' event never fired, using sustained talking=1 instead", {
            sustainedMs: Date.now() - talkingSinceRef.current,
          });
          setStatus((prev) => (prev === "incoming" ? prev : "on_call"));
        }
      } else if (!talking) {
        talkingSinceRef.current = null;
        if (wasTalkingRef.current && !confirmedByEventRef.current) {
          // Call ended and the event hooks never told us — same fallback
          // reasoning as above, applied to the end transition.
          setIncomingNumber(null);
          setMuted(false);
          setStatus("ready");
        }
      }
      wasTalkingRef.current = talking;
    }, POLL_INTERVAL_MS);
  }

  const placeCall = useCallback(
    (number: string) => {
      if (status !== "ready") return false;
      log("placeCall invoked", { numberLength: number.length });
      try {
        window.zdrmWPhI?.call?.(number);
        return true;
      } catch (e) {
        log("placeCall threw", { error: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
    [status]
  );

  const answerCall = useCallback(() => {
    try {
      window.zdrmWPhI?.answer?.();
    } catch {
      // Best-effort — if this silently does nothing, the agent still has
      // Zadarma's own hidden default widget registered, just without our
      // custom button working; nothing else in the CRM breaks.
    }
  }, []);

  const rejectCall = useCallback(() => {
    try {
      window.zdrmWPhI?.cancel?.();
    } catch {
      // See answerCall.
    }
    confirmedByEventRef.current = false;
    setIncomingNumber(null);
    setStatus("ready");
  }, []);

  const hangUp = useCallback(() => {
    try {
      window.zdrmWPhI?.finishCall?.();
    } catch {
      // See answerCall.
    }
    confirmedByEventRef.current = false;
    setIncomingNumber(null);
    setMuted(false);
    setStatus("ready");
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try {
        window.zdrmWPhI?.micSwitch?.(next ? "off" : "on");
      } catch {
        // See answerCall.
      }
      return next;
    });
  }, []);

  return (
    <ZadarmaPhoneContext.Provider value={{ status, unavailableReason, incomingNumber, muted, placeCall, answerCall, rejectCall, hangUp, toggleMute }}>
      {children}
    </ZadarmaPhoneContext.Provider>
  );
}
