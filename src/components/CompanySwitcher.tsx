"use client";

import { RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { useCompany, ALL_COMPANIES, CompanyId } from "@/context/CompanyContext";
import { useLanguage } from "@/context/LanguageContext";

export function useCompanyLabel() {
  const { t } = useLanguage();
  const { activeCompany } = useCompany();
  return activeCompany === ALL_COMPANIES ? t("All companies", "Todas las empresas") : activeCompany;
}

/** Portal-rendered dropdown that lets the user switch the active company. Anchored to an
 * external trigger element (e.g. the "switch account" button in the sidebar) rather than
 * rendering its own trigger, so it can be wired into existing UI. */
export function CompanySwitcherMenu({
  open,
  onClose,
  anchorRef,
  placement = "up",
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  /** "up" (default) opens above the anchor, e.g. the sidebar footer trigger.
   * "down" opens below it, for a top-bar trigger near the top of the viewport. */
  placement?: "up" | "down";
}) {
  const { t } = useLanguage();
  const { companies, activeCompany, setActiveCompany } = useCompany();
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 236 });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount flag so the portal only renders client-side
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (placement === "down") {
      setCoords({
        top: rect.bottom + 8,
        left: Math.max(8, Math.min(rect.right - 236, window.innerWidth - 252)),
        width: 236,
      });
    } else {
      setCoords({
        top: Math.max(8, rect.top - 8),
        left: Math.min(rect.right + 12, window.innerWidth - 252),
        width: 236,
      });
    }
  }, [open, anchorRef, placement]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose, anchorRef]);

  if (!mounted || !open) return null;

  function choose(company: CompanyId) {
    setActiveCompany(company);
    onClose();
  }

  return createPortal(
    <div
      ref={panelRef}
      role="listbox"
      aria-label={t("Switch company", "Cambiar de empresa")}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        width: coords.width,
        transform: placement === "up" ? "translateY(-100%)" : undefined,
      }}
      className="z-[60] max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-white py-1.5 shadow-[0_12px_32px_-8px_rgba(16,24,40,0.28)]"
    >
      <p className="px-3 pb-1.5 pt-1 text-[11px] font-semibold tracking-wide text-text-tertiary">
        {t("SWITCH COMPANY", "CAMBIAR DE EMPRESA")}
      </p>

      <button
        role="option"
        aria-selected={activeCompany === ALL_COMPANIES}
        onClick={() => choose(ALL_COMPANIES)}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] font-medium transition-colors",
          activeCompany === ALL_COMPANIES ? "bg-brand-50 text-brand-700" : "text-text-primary hover:bg-surface-muted"
        )}
      >
        <Avatar name={t("All companies", "Todas las empresas")} size={24} />
        <span className="flex-1 truncate">{t("All companies", "Todas las empresas")}</span>
        {activeCompany === ALL_COMPANIES && <Check className="h-4 w-4 shrink-0 text-brand" />}
      </button>

      <div className="my-1 h-px bg-border" />

      {companies.map((c) => (
        <button
          key={c}
          role="option"
          aria-selected={activeCompany === c}
          onClick={() => choose(c)}
          className={cn(
            "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] font-medium transition-colors",
            activeCompany === c ? "bg-brand-50 text-brand-700" : "text-text-primary hover:bg-surface-muted"
          )}
        >
          <Avatar name={c} size={24} />
          <span className="flex-1 truncate">{c}</span>
          {activeCompany === c && <Check className="h-4 w-4 shrink-0 text-brand" />}
        </button>
      ))}
    </div>,
    document.body
  );
}
