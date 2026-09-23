"use client";

import { LayoutGrid, Square, Sparkles } from "lucide-react";
import { useTheme, DesignSystem } from "@/context/ThemeContext";
import { cn } from "@/lib/cn";

const options: { id: DesignSystem; label: string; icon: React.ElementType }[] = [
  { id: "bento", label: "Bento", icon: LayoutGrid },
  { id: "brutalist", label: "Brutalist", icon: Square },
  { id: "aurora", label: "Aurora", icon: Sparkles },
];

export function DesignSystemSwitcher() {
  const { designSystem, setDesignSystem } = useTheme();

  return (
    <div className="fixed bottom-5 left-5 z-50 hidden items-center gap-1 rounded-2xl border border-border bg-surface/95 p-1.5 shadow-[0_8px_24px_-6px_rgba(16,24,40,0.18)] backdrop-blur-md lg:flex">
      {options.map((o) => {
        const Icon = o.icon;
        const active = designSystem === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setDesignSystem(o.id)}
            title={`${o.label} design`}
            aria-label={`${o.label} design`}
            aria-pressed={active}
            className={cn(
              "flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[12px] font-medium transition-colors",
              active
                ? "bg-text-primary text-white"
                : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
