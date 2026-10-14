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
 * rendered when present; a load failure (expired signed URL, network error,
 * etc.) falls back to the existing initials rendering via `onError` rather
 * than showing a broken image — never a silent blank avatar. No external
 * image library/config involved: a plain `<img>`, since this codebase has no
 * existing next/image usage or configured remotePatterns to extend. */
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
  const [imageFailed, setImageFailed] = useState(false);
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  const color = palette[hashOf(name) % palette.length];

  if (imageUrl && !imageFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external, unpredictable Metricool/Meta CDN URL; no next/image remotePatterns configured anywhere in this repo
      <img
        src={imageUrl}
        alt={name}
        onError={() => setImageFailed(true)}
        className={cn("rounded-full object-cover shrink-0", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full font-semibold text-white shrink-0",
        color,
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || "?"}
    </div>
  );
}
