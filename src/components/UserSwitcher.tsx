"use client";

import { RefObject, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { useLanguage } from "@/context/LanguageContext";
import { startImpersonationAction } from "@/app/(dashboard)/actions";
import { ROLE_LABEL, ROLE_LABEL_ES } from "@/lib/roles";
import type { RoleKey } from "@/server/constants";

export type ImpersonatableUser = { id: string; fullName: string; roleKey: RoleKey };

/** Portal-rendered dropdown listing real user accounts a Superuser can switch into
 * (see startImpersonationAction). Mirrors CompanySwitcherMenu's anchor/portal pattern,
 * but selecting an entry performs a real sign-in swap rather than local UI state. */
export function UserSwitcherMenu({
  open,
  onClose,
  anchorRef,
  users,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  users: ImpersonatableUser[];
}) {
  const { t, language } = useLanguage();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 236 });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  const roleLabels = language === "es" ? ROLE_LABEL_ES : ROLE_LABEL;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount flag so the portal only renders client-side
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({
      top: Math.max(8, rect.top - 8),
      left: Math.min(rect.right + 12, window.innerWidth - 252),
      width: 236,
    });
  }, [open, anchorRef]);

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

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale error when menu is reopened later
      setError(null);
    }
  }, [open]);

  if (!mounted || !open) return null;

  function choose(userId: string) {
    if (pendingId) return;
    setPendingId(userId);
    setError(null);
    startTransition(async () => {
      const result = await startImpersonationAction(userId);
      setPendingId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return createPortal(
    <div
      ref={panelRef}
      role="listbox"
      aria-label={t("Switch user", "Cambiar de usuario")}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        width: coords.width,
        transform: "translateY(-100%)",
      }}
      className="z-[60] max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-white py-1.5 shadow-[0_12px_32px_-8px_rgba(16,24,40,0.28)]"
    >
      <p className="px-3 pb-1.5 pt-1 text-[11px] font-semibold tracking-wide text-text-tertiary">
        {t("SWITCH USER", "CAMBIAR DE USUARIO")}
      </p>

      {users.length === 0 && (
        <p className="px-3 py-2 text-[13px] text-text-tertiary">
          {t("No users available.", "No hay usuarios disponibles.")}
        </p>
      )}

      {users.map((u) => (
        <button
          key={u.id}
          role="option"
          aria-selected={false}
          disabled={pendingId !== null}
          onClick={() => choose(u.id)}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] font-medium text-text-primary transition-colors hover:bg-surface-muted disabled:opacity-60"
        >
          <Avatar name={u.fullName} size={24} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{u.fullName}</span>
            <span className="block truncate text-[11.5px] font-normal text-text-tertiary">
              {roleLabels[u.roleKey]}
            </span>
          </span>
          {pendingId === u.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" />}
        </button>
      ))}

      {error && <p className={cn("px-3 pb-1 pt-1.5 text-[12px] text-danger")}>{error}</p>}
    </div>,
    document.body
  );
}
