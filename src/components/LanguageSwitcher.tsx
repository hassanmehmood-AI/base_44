"use client";

import { Globe } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/cn";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { language, setLanguage } = useLanguage();

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border border-border bg-white px-2 py-1 text-[13px] font-medium shadow-sm transition-all hover:border-gray-300",
        className
      )}
    >
      <Globe className="h-3.5 w-3.5 text-text-tertiary mr-0.5" />
      <button
        type="button"
        onClick={() => setLanguage("en")}
        className={cn(
          "rounded-md px-2 py-0.5 text-[12px] font-semibold transition-all",
          language === "en"
            ? "bg-text-primary text-white shadow-xs"
            : "text-text-secondary hover:text-text-primary hover:bg-gray-100"
        )}
      >
        EN
      </button>
      <span className="text-border text-[11px] select-none">|</span>
      <button
        type="button"
        onClick={() => setLanguage("es")}
        className={cn(
          "rounded-md px-2 py-0.5 text-[12px] font-semibold transition-all",
          language === "es"
            ? "bg-text-primary text-white shadow-xs"
            : "text-text-secondary hover:text-text-primary hover:bg-gray-100"
        )}
      >
        ES
      </button>
    </div>
  );
}
