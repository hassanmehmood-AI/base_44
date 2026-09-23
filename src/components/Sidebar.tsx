"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Sprout,
  Database,
  LayoutGrid,
  Megaphone,
  Radio,
  Share2,
  MessageCircle,
  Mail,
  Phone,
  Globe,
  BarChart3,
  Settings,
  Headset,
  ChevronDown,
  ArrowLeftRight,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";

import { useLanguage } from "@/context/LanguageContext";

const REVEAL =
  "whitespace-nowrap lg:opacity-0 lg:-translate-x-1 transition-all duration-[650ms] ease-[cubic-bezier(0.16,1,0.3,1)] delay-0 lg:group-hover:delay-200 lg:group-hover:opacity-100 lg:group-hover:translate-x-0";

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  indent,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  indent?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "ds-nav-item flex items-center gap-3 rounded-[var(--radius-button)] px-3 text-[14px] font-medium transition-colors",
        active ? "py-2" : "py-1.5",
        indent && "ml-2",
        active
          ? "ds-nav-item-active bg-sidebar-active text-white"
          : "text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-heading"
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
      <span className={cn("truncate", REVEAL)}>{label}</span>
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "px-3 pt-2 pb-0.5 text-[11px] font-semibold tracking-widest text-sidebar-text-dim",
        REVEAL
      )}
    >
      {children}
    </p>
  );
}

export function Sidebar({
  mobileOpen = false,
  onClose,
}: {
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const channelsActive = pathname.startsWith("/canales");
  const [channelsOpen, setChannelsOpen] = useState(true);

  const channelLinks = [
    { href: "/canales/whatsapp", label: t("WhatsApp", "WhatsApp"), icon: MessageCircle },
    { href: "/canales/correo", label: t("Email", "Correo"), icon: Mail },
    { href: "/canales/llamadas", label: t("Calls", "Llamadas"), icon: Phone },
    { href: "/canales/redes-sociales", label: t("Social Media", "Redes Sociales"), icon: Globe },
  ];

  const workspaceLinks = [
    { href: "/prospeccion", label: t("Client Prospecting", "Prospección de Clientes"), icon: Database },
    { href: "/crm", label: t("CRM", "CRM"), icon: LayoutGrid },
    { href: "/campanas", label: t("Manage Campaigns", "Gestionar Campañas"), icon: Megaphone },
    { href: "/campanas-activas", label: t("Active Campaigns", "Campañas Activas"), icon: Radio },
  ];

  const adminLinks = [
    { href: "/configuracion", label: t("Settings", "Configuración"), icon: Settings },
    { href: "/soporte", label: t("Technical Support", "Soporte Técnico"), icon: Headset },
  ];

  return (
    <aside
      className={cn(
        "ds-sidebar group peer fixed inset-y-0 left-0 z-50 flex w-72 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar shadow-2xl transition-transform duration-300 ease-out",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        "lg:translate-x-0 lg:top-3 lg:left-3 lg:inset-y-auto lg:z-40 lg:max-h-[calc(100vh-1.5rem)] lg:w-[72px] lg:rounded-2xl lg:border lg:shadow-[0_2px_16px_rgba(0,0,0,0.12)] lg:transition-[width,box-shadow] lg:duration-[850ms] lg:ease-[cubic-bezier(0.16,1,0.3,1)] lg:hover:w-[260px] lg:hover:shadow-[8px_8px_32px_rgba(0,0,0,0.22)]"
      )}
    >
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-1">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand">
          <Sprout className="h-5 w-5 text-white" strokeWidth={2.2} />
        </div>
        <span className={cn("text-[18px] font-bold tracking-tight text-sidebar-heading", REVEAL)}>
          GROWTH-ON
        </span>
        <button
          onClick={onClose}
          aria-label="Close menu"
          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-heading lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 min-h-[502px] overflow-hidden px-3 pb-2">
        <SectionLabel>{t("WORKSPACE", "ESPACIO DE TRABAJO")}</SectionLabel>
        <div className="flex flex-col gap-1">
          {workspaceLinks.map((l) => (
            <NavItem key={l.href} {...l} active={pathname === l.href} onNavigate={onClose} />
          ))}

          <button
            onClick={() => setChannelsOpen((v) => !v)}
            className={cn(
              "ds-nav-item flex items-center gap-3 rounded-[var(--radius-button)] px-3 py-1.5 text-[14px] font-medium transition-colors",
              channelsActive
                ? "text-sidebar-heading"
                : "text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-heading"
            )}
          >
            <Share2 className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
            <span className={cn("flex-1 text-left truncate", REVEAL)}>
              {t("Channels", "Canales")}
            </span>
            <ChevronDown
              className={cn("h-4 w-4 shrink-0", REVEAL, channelsOpen && "rotate-180")}
            />
          </button>

          {channelsOpen && (
            <div className="flex flex-col gap-1 border-l border-sidebar-border ml-[22px] pl-2 lg:opacity-0 lg:pointer-events-none transition-opacity duration-[650ms] ease-[cubic-bezier(0.16,1,0.3,1)] delay-0 lg:group-hover:delay-200 lg:group-hover:opacity-100 lg:group-hover:pointer-events-auto">
              {channelLinks.map((l) => (
                <NavItem key={l.href} {...l} active={pathname === l.href} indent onNavigate={onClose} />
              ))}
            </div>
          )}

          <NavItem
            href="/kpis"
            label={t("KPI's", "KPI's")}
            icon={BarChart3}
            active={pathname === "/kpis"}
            onNavigate={onClose}
          />
        </div>

        <SectionLabel>{t("ADMINISTRATION", "ADMINISTRACIÓN")}</SectionLabel>
        <div className="flex flex-col gap-1">
          {adminLinks.map((l) => (
            <NavItem key={l.href} {...l} active={pathname === l.href} onNavigate={onClose} />
          ))}
        </div>
      </nav>

      <div className="flex items-center gap-3 border-t border-sidebar-border px-4 py-2">
        <Avatar name="David Leyva" size={28} />
        <div className={cn("min-w-0 flex-1", REVEAL)}>
          <p className="truncate text-[13.5px] font-semibold text-sidebar-heading">David Leyva</p>
          <p className="truncate text-[12px] text-sidebar-text-dim">{t("Superuser", "Superusuario")}</p>
        </div>
        <button
          className={cn(
            "shrink-0 text-sidebar-text-dim hover:text-sidebar-heading",
            REVEAL
          )}
          aria-label="Switch account"
        >
          <ArrowLeftRight className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
