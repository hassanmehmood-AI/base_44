"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

const palette = [
  "bg-brand",
  "bg-[#2E90FA]",
  "bg-[#7A5AF8]",
  "bg-[#0E7490]",
  "bg-[#B54708]",
  "bg-[#475467]",
];

function hashOf(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

/** `attempt` tracks how many times THIS url has failed to load so far —
 * separate from `failed` (the terminal "give up, show initials" state).
 * This is what fixes the sticky-failure bug: a permanently-stored avatar's
 * url never changes between page loads, so without a retry counter a single
 * one-off network/server hiccup on any ONE of the several independent
 * <img> instances showing it (inbox row, chat header, profile card) would
 * stay stuck on initials for that instance's entire lifetime — see
 * decideOnImageError's doc comment for the full mechanics. */
export type AvatarImageState = { url: string | null; loaded: boolean; failed: boolean; attempt: number };

/** Re-points the tracked state at a new `url`, resetting loaded/failed/attempt
 * — this is what makes the component retry a fresh image instead of staying
 * stuck on a previous failure, AND what correctly resets retry state when
 * switching to a different customer's conversation (a different url is
 * exactly what happens when `imageUrl` changes between conversations).
 * Returns the SAME object (not a new one) when `url` hasn't actually
 * changed, so calling this on every render is a safe, cheap no-op that
 * never triggers an extra re-render by itself. */
export function withTrackedUrl(state: AvatarImageState, url: string | null): AvatarImageState {
  return url === state.url ? state : { url, loaded: false, failed: false, attempt: 0 };
}

export function withLoaded(state: AvatarImageState): AvatarImageState {
  return { ...state, loaded: true };
}

/** Terminal "give up" transition — used once decideOnImageError below has
 * exhausted its retry budget. Kept as its own small function (rather than
 * inlined) so the existing "mark failed, preserve url/loaded" contract
 * stays simple and independently testable, same as before retries existed. */
export function withFailed(state: AvatarImageState): AvatarImageState {
  return { ...state, failed: true };
}

/** Bounded to avoid both infinite retries and unnecessary requests — once a
 * genuinely dead/unauthorized/missing avatar has failed this many times,
 * retrying further would never succeed and only adds load. 2 retries (3
 * total attempts) is enough to ride out a one-off transient hiccup (a cold
 * Railway function, a brief storage-read blip, two near-simultaneous
 * requests for the same url racing) without masking a genuinely persistent
 * failure (a real 403/404) for long. */
export const MAX_RETRY_ATTEMPTS = 2;

/** Short delay between retries — long enough to give a transient hiccup a
 * moment to clear, short enough that a real recovery is still fast. */
export const RETRY_DELAY_MS = 600;

export type ImageErrorDecision = { action: "retry"; nextAttempt: number } | { action: "giveUp" };

/** The retry decision itself, pulled out as a pure function so it's testable
 * without timers, a DOM, or a real image load — see Avatar.test.ts. Every
 * `onError` call site in the component funnels through this single
 * decision point, so there's exactly one place that defines "how many
 * retries" and "when do we finally show initials." */
export function decideOnImageError(state: AvatarImageState): ImageErrorDecision {
  if (state.attempt < MAX_RETRY_ATTEMPTS) {
    return { action: "retry", nextAttempt: state.attempt + 1 };
  }
  return { action: "giveUp" };
}

/** `imageUrl` (e.g. Metricool's MetricoolParticipant.imageProfileUrl) is
 * layered over the initials, never swapped in for them — Metricool's picture
 * URLs are signed, short-lived Facebook Graph API URLs (confirmed live: one
 * stored a few hours returned "Invalid appsecret_time... has expired"), so
 * persisting one and expecting it to still be valid whenever a user later
 * views the page is unreliable by design, not just an edge case. Starting
 * from "assume it won't load" and only revealing the `<img>` once `onLoad`
 * actually confirms success means a dead/expired URL never shows the
 * browser's broken-image glyph — it just silently stays on the initials
 * underneath, which is the only state that's ever actually visible then.
 * No external image library/config involved: a plain `<img>`, since this
 * codebase has no existing next/image usage or configured remotePatterns to
 * extend.
 *
 * `loaded`/`failed` are tracked per-URL (via `withTrackedUrl`), not just per
 * mount: a prior failure (e.g. an expired signed URL) must not stick forever
 * once a later re-render supplies a genuinely different, possibly-valid
 * `imageUrl` for the same conversation row — otherwise a live-refreshed
 * avatar could never recover without a full page reload. Adjusting state
 * during render (guarded by the `url === state.url` check in
 * `withTrackedUrl`, which no-ops when nothing changed) is React's documented
 * pattern for resetting state from a prop change without an extra
 * effect-triggered render. */
export function Avatar({
  name,
  imageUrl,
  size = 36,
  className,
}: {
  name: string;
  imageUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const normalizedUrl = imageUrl ?? null;
  const [state, setState] = useState<AvatarImageState>({ url: normalizedUrl, loaded: false, failed: false, attempt: 0 });
  const next = withTrackedUrl(state, normalizedUrl);
  if (next !== state) setState(next);

  // A pending retry timer is cleared whenever the url changes mid-wait (the
  // user switched conversations before the delay elapsed) — otherwise a
  // stale timer could fire a retry against a url that's no longer even
  // being shown, or worse, stomp a different conversation's fresh state.
  // Also cleared on unmount, so navigating away never leaves a dangling
  // setState call.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [state.url]);

  function handleImageError() {
    const decision = decideOnImageError(state);
    if (decision.action === "giveUp") {
      setState((s) => (s.url === state.url ? withFailed(s) : s));
      return;
    }
    const erroredUrl = state.url;
    retryTimerRef.current = setTimeout(() => {
      // Guards against a race where the conversation (and therefore the
      // url) changed during the delay — only applies the retry if we're
      // still looking at the same url this timer was scheduled for.
      setState((s) => (s.url === erroredUrl ? { ...s, attempt: decision.nextAttempt } : s));
    }, RETRY_DELAY_MS);
  }

  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  const color = palette[hashOf(name) % palette.length];

  return (
    <div
      className={cn("relative shrink-0 overflow-hidden rounded-full", className)}
      style={{ width: size, height: size }}
    >
      <div
        className={cn("flex h-full w-full items-center justify-center font-semibold text-white", color)}
        style={{ fontSize: size * 0.38 }}
      >
        {initials || "?"}
      </div>
      {state.url && !state.failed && (
        // eslint-disable-next-line @next/next/no-img-element -- external, unpredictable Metricool/Meta CDN URL; no next/image remotePatterns configured anywhere in this repo
        <img
          // Keying on attempt (not just url) is what actually triggers a
          // retry: React treats a key change as a brand-new element, so
          // bumping `attempt` unmounts this <img> and mounts a fresh one
          // with the same src — issuing a genuinely new request rather than
          // relying on the browser to somehow re-try a failed load on its
          // own (it won't).
          key={`${state.url}-${state.attempt}`}
          src={state.url}
          alt={name}
          onLoad={() => setState((s) => (s.url === state.url ? withLoaded(s) : s))}
          onError={handleImageError}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity",
            state.loaded ? "opacity-100" : "opacity-0"
          )}
        />
      )}
    </div>
  );
}
