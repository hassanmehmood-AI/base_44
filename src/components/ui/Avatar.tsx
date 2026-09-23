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

export function Avatar({
  name,
  size = 36,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  const color = palette[hashOf(name) % palette.length];

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
