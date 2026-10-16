"use client";

import { useState } from "react";
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

export type AvatarImageState = { url: string | null; loaded: boolean; failed: boolean };

/** Re-points the tracked state at a new `url`, resetting `loaded`/`failed` —
 * this is what makes the component retry a fresh image instead of staying
 * stuck on a previous failure. Returns the SAME object (not a new one) when
 * `url` hasn't actually changed, so calling this on every render is a safe,
 * cheap no-op that never triggers an extra re-render by itself. */
export function withTrackedUrl(state: AvatarImageState, url: string | null): AvatarImageState {
  return url === state.url ? state : { url, loaded: false, failed: false };
}

export function withLoaded(state: AvatarImageState): AvatarImageState {
  return { ...state, loaded: true };
}

export function withFailed(state: AvatarImageState): AvatarImageState {
  return { ...state, failed: true };
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
  const [state, setState] = useState<AvatarImageState>({ url: normalizedUrl, loaded: false, failed: false });
  const next = withTrackedUrl(state, normalizedUrl);
  if (next !== state) setState(next);

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
          key={state.url}
          src={state.url}
          alt={name}
          onLoad={() => setState((s) => withLoaded(s))}
          onError={() => setState((s) => withFailed(s))}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity",
            state.loaded ? "opacity-100" : "opacity-0"
          )}
        />
      )}
    </div>
  );
}
