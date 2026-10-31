"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLanguage } from "@/context/LanguageContext";
import { getMyOnlineStatusAction, setMyOnlineStatusAction } from "@/app/(dashboard)/actions";
import type { AgentOnlineStatus } from "@/server/constants";

/** A self-contained, self-fetching Online/Offline toggle for the signed-in
 * agent — fetches its own status on mount rather than taking a server-
 * rendered prop, so it can be dropped into any client page (here, Client
 * Prospecting's header) without that page needing to thread session data
 * through. Server-side scoped to CALL_CENTER_AGENT only (see
 * getMyOnlineStatus's doc comment) — renders nothing at all for every other
 * role, so it's always safe to mount regardless of who's viewing the page.
 * Optimistic toggle with revert-on-failure. Purely a self-reported
 * visibility signal shown to Manager/Director/Superuser in Configuración —
 * has no effect on Round Robin or assignment eligibility. */
export function AgentOnlineButton({ className }: { className?: string }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<AgentOnlineStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getMyOnlineStatusAction().then((s) => {
      if (!cancelled) {
        setStatus(s);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Not an agent (or still loading) — render nothing rather than a
  // meaningless placeholder.
  if (!loaded || status === null) return null;

  const isOnline = status === "ONLINE";

  function toggle() {
    const previous = status;
    const next: AgentOnlineStatus = isOnline ? "OFFLINE" : "ONLINE";
    setStatus(next); // optimistic
    startTransition(async () => {
      const res = await setMyOnlineStatusAction(next);
      if (res.error) setStatus(previous); // revert on failure
    });
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2.5 rounded-xl border border-border bg-white px-3 py-1.5 text-[13px] font-medium shadow-sm transition-all hover:border-gray-300",
        className
      )}
    >
      <span className={cn("select-none", isOnline ? "text-brand-700" : "text-text-secondary")}>
        {isOnline ? t("Online", "En línea") : t("Offline", "Desconectado")}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={isOnline}
        onClick={toggle}
        disabled={pending}
        title={
          isOnline
            ? t("You're visible as Online to your Manager/Director", "Apareces como En línea para tu Manager/Director")
            : t("You're visible as Offline to your Manager/Director", "Apareces como Desconectado para tu Manager/Director")
        }
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          isOnline ? "bg-brand" : "bg-gray-300"
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
            isOnline ? "translate-x-6" : "translate-x-1"
          )}
        />
        {pending && <Loader2 className="absolute inset-0 m-auto h-3 w-3 animate-spin text-white" />}
      </button>
    </div>
  );
}
