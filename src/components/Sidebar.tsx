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
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";

import { useLanguage } from "@/context/LanguageContext";

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  indent,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  indent?: boolean;
}) {
  return (
    <Link
      href={href}
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
      <span className="truncate whitespace-nowrap opacity-0 -translate-x-1 transition-all duration-[650ms] ease-[cubic-bezier(0.16,1,0.3,1)] delay-0 group-hover:delay-200 group-hover:opacity-100 group-hover:translate-x-0">
        {label}
      </span>
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-2 pb-0.5 text-[11px] font-semibold tracking-widest text-sidebar-text-dim whitespace-nowrap opacity-0 -translate-x-1 transition-all duration-[650ms] ease-[cubic-bezier(0.16,1,0.3,1)] delay-0 group-hover:delay-200 group-hover:opacity-100 group-hover:translate-x-0">
      {children}
    </p>
  );
}

export function Sidebar() {
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
    <aside className="ds-sidebar group peer fixed top-3 left-3 z-40 flex max-h-[calc(100vh-1.5rem)] w-[72px] flex-col overflow-hidden rounded-2xl border border-sidebar-border bg-sidebar shadow-[0_2px_16px_rgba(0,0,0,0.12)] transition-[width,box-shadow] duration-[850ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:w-[260px] hover:shadow-[8px_8px_32px_rgba(0,0,0,0.22)]">
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-1">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand">
          <Sprout className="h-5 w-5 text-white" strokeWidth={2.2} />
        </div>
        <span className="text-[18px] font-bold tracking-tight text-sidebar-heading whitespace-nowrap opacity-0 -translate-x-1 transition-all duration-[650ms] ease-[cubic-bezier(0.16,1,0.3,1)] delay-0 group-hover:delay-200 group-hover:opacity-100 group-hover:translate-x-0">
          GROWTH-ON
        </span>
      </div>

      <nav className="flex-1 min-h-[502px] overflow-hidden px-3 pb-2">
        <SectionLabel>{t("WORKSPACE", "ESPACIO DE TRABAJO")}</SectionLabel>
        <div className="flex flex-col gap-1">
          {workspaceLinks.map((l) => (
            <NavItem key={l.href} {...l} active={pathname === l.href} />
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
            <span className="flex-1 text-left truncate whitespace-nowrap opacity-0 -translate-x-1 transition-all duration-[650ms] ease-[cubic-bezier(0.16,1,0.3,1)] delay-0 group-hover:delay-200 group-hover:opacity-100 group-hover:translate-x-0">
              {t("Channels", "Canales")}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 transition-all duration-[650ms] ease-[cubic-bezier(0.16,1,0.3,1)] delay-0 group-hover:delay-200 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0",
                channelsOpen && "rotate-180"
              )}
            />
          </button>

          {channelsOpen && (
            <div className="flex flex-col gap-1 border-l border-sidebar-border ml-[22px] pl-2 opacity-0 pointer-events-none transition-opacity duration-[650ms] ease-[cubic-bezier(0.16,1,0.3,1)] delay-0 group-hover:delay-200 group-hover:opacity-100 group-hover:pointer-events-auto">
              {channelLinks.map((l) => (
                <NavItem key={l.href} {...l} active={pathname === l.href} indent />
              ))}
            </div>
          )}

          <NavItem
            href="/kpis"
            label={t("KPI's", "KPI's")}
            icon={BarChart3}
            active={pathname === "/kpis"}
          />
        </div>

        <SectionLabel>{t("ADMINISTRATION", "ADMINISTRACIÓN")}</SectionLabel>
        <div className="flex flex-col gap-1">
          {adminLinks.map((l) => (
            <NavItem key={l.href} {...l} active={pathname === l.href} />
          ))}
        </div>
      </nav>

      <div className="flex items-center gap-3 border-t border-sidebar-border px-4 py-2">
        <Avatar name="David Leyva" size={28} />
        <div className="min-w-0 flex-1 whitespace-nowrap opacity-0 -translate-x-1 transition-all duration-[650ms] ease-[cubic-bezier(0.16,1,0.3,1)] delay-0 group-hover:delay-200 group-hover:opacity-100 group-hover:translate-x-0">
          <p className="truncate text-[13.5px] font-semibold text-sidebar-heading">David Leyva</p>
          <p className="truncate text-[12px] text-sidebar-text-dim">{t("Superuser", "Superusuario")}</p>
        </div>
        <button
          className="shrink-0 text-sidebar-text-dim hover:text-sidebar-heading transition-all duration-[650ms] ease-[cubic-bezier(0.16,1,0.3,1)] delay-0 group-hover:delay-200 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0"
          aria-label="Switch account"
        >
          <ArrowLeftRight className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
