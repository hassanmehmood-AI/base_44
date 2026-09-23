"use client";

import { Check, Palette } from "lucide-react";
import { useTheme, ColorTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/cn";

const options: { id: ColorTheme; label: string; swatch: string }[] = [
  { id: "blue", label: "Blue", swatch: "#2563eb" },
  { id: "gray", label: "Gray", swatch: "#475569" },
  { id: "orange", label: "Orange", swatch: "#c2410c" },
];

export function ColorThemeSwitcher() {
  const { colorTheme, setColorTheme } = useTheme();

  return (
    <div className="fixed bottom-5 right-5 z-50 hidden items-center gap-2 rounded-2xl border border-border bg-surface/95 px-3 py-2 shadow-[0_8px_24px_-6px_rgba(16,24,40,0.18)] backdrop-blur-md lg:flex">
      <Palette className="h-3.5 w-3.5 text-text-tertiary" />
      <div className="flex items-center gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setColorTheme(o.id)}
            title={`${o.label} theme`}
            aria-label={`${o.label} theme`}
            aria-pressed={colorTheme === o.id}
            className={cn(
              "relative flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-surface transition-transform hover:scale-110",
              colorTheme === o.id ? "ring-text-primary" : "ring-transparent"
            )}
            style={{ backgroundColor: o.swatch }}
          >
            {colorTheme === o.id && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
          </button>
        ))}
      </div>
    </div>
  );
}
