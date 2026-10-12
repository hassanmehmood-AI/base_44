"use client";

import { useRef, useState } from "react";
import { Building2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { CompanySwitcherMenu, useCompanyLabel } from "@/components/CompanySwitcher";
import { useLanguage } from "@/context/LanguageContext";

/** Global company selector (see CompanySwitcher.tsx), rendered inline as
 * part of each page's scrollable content — not a fixed/sticky header bar —
 * so it's reachable without opening the sidebar footer. The sidebar's own
 * switcher stays in place as secondary access to the same CompanyContext
 * state. Rendered once, from DashboardShell, above `{children}`. */
export function TopBar() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const companyLabel = useCompanyLabel();

  return (
    <div className="flex items-center justify-end">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("Switch company", "Cambiar de empresa")}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-white px-3.5 py-2 text-[13.5px] font-medium text-text-primary transition-colors hover:border-gray-300 hover:bg-surface-muted"
        )}
      >
        <Building2 className="h-4 w-4 text-text-tertiary" />
        <span className="max-w-[180px] truncate">{companyLabel}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-text-tertiary transition-transform", open && "rotate-180")} />
      </button>

      <CompanySwitcherMenu open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} placement="down" />
    </div>
  );
}
