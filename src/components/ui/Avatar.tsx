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
 * extend. */
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
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
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
      {imageUrl && !failed && (
        // eslint-disable-next-line @next/next/no-img-element -- external, unpredictable Metricool/Meta CDN URL; no next/image remotePatterns configured anywhere in this repo
        <img
          src={imageUrl}
          alt={name}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity",
            loaded ? "opacity-100" : "opacity-0"
          )}
        />
      )}
    </div>
  );
}
