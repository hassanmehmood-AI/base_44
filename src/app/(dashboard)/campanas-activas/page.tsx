"use client";

import { useState } from "react";
import { Plus, MessageCircle, Mail, Phone, ArrowRight } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { PageHeader } from "@/components/PageHeader";
import { useLanguage } from "@/context/LanguageContext";
import { assignedClients, channelSummary } from "@/lib/mock-data";
import { cn } from "@/lib/cn";

export default function CampanasActivasPage() {
  const { t } = useLanguage();
  const [selectedClient, setSelectedClient] = useState(assignedClients[0].id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Active Campaigns", "Campañas Activas")}
        subtitle={t("Manage your assigned clients and contact channels", "Gestiona tus clientes asignados y canales de contacto")}
        actions={
          <>
            <div className="w-[260px]">
              <Select defaultValue="Contact-On">
                <option value="Contact-On">{t("Campaigns and contacts of: Contact-On", "Campañas y contactos de: Contact-On")}</option>
                <option value="Leyva">{t("Campaigns and contacts of: Leyva", "Campañas y contactos de: Leyva")}</option>
                <option value="Rockstar">{t("Campaigns and contacts of: Rockstar", "Campañas y contactos de: Rockstar")}</option>
              </Select>
            </div>
            <div className="w-[160px]">
              <Select defaultValue="Solange">
                <option>Solange</option>
                <option>Milagros</option>
                <option>Ana Victoria</option>
              </Select>
            </div>
            <Button>
              <Plus className="h-4 w-4" /> {t("New contact", "Nuevo contacto")}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
        <Card className="p-5">
          <CardTitle>{t("My assigned clients", "Mis clientes asignados")}</CardTitle>
          <div className="mt-4 flex flex-col gap-2">
            {assignedClients.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedClient(c.id)}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3.5 py-2.5 text-left text-[14px] font-medium transition-colors",
                  selectedClient === c.id
                    ? "bg-brand-50 text-text-primary"
                    : "text-text-secondary hover:bg-surface-muted"
                )}
              >
                {c.name}
                {c.active && <span className="h-2 w-2 rounded-full bg-brand" />}
              </button>
            ))}
          </div>
        </Card>

        <ChannelCard
          icon={MessageCircle}
          iconTone="text-brand bg-brand-50"
          title="WhatsApp"
          rows={[
            [t("Unread", "Sin leer"), channelSummary.whatsapp.sinLeer],
            [t("Hot sales", "Ventas calientes"), channelSummary.whatsapp.ventasCalientes],
            [t("Follow-ups today", "Seguimientos hoy"), channelSummary.whatsapp.seguimientosHoy],
          ]}
          cta={t("Open WhatsApp", "Abrir WhatsApp")}
          href="/canales/whatsapp"
        />
        <ChannelCard
          icon={Mail}
          iconTone="text-info bg-info-50"
          title={t("Email", "Correo")}
          rows={[
            [t("Unread", "Sin leer"), channelSummary.correo.sinLeer],
            [t("Replies today", "Respuestas hoy"), channelSummary.correo.respuestasHoy],
            [t("Pending", "Pendientes"), channelSummary.correo.pendientes],
          ]}
          cta={t("Open email", "Abrir correo")}
          href="/canales/correo"
        />
        <ChannelCard
          icon={Phone}
          iconTone="text-warning bg-warning-50"
          title={t("Calls", "Llamadas")}
          rows={[
            [t("Calls today", "Llamadas hoy"), channelSummary.llamadas.llamadasHoy],
            [t("Answered", "Contestadas"), channelSummary.llamadas.contestadas],
            [t("Callbacks", "Rellamadas"), channelSummary.llamadas.rellamadas],
          ]}
          cta={t("Open calls", "Abrir llamadas")}
          href="/canales/llamadas"
        />
      </div>
    </div>
  );
}

function ChannelCard({
  icon: Icon,
  iconTone,
  title,
  rows,
  cta,
  href,
}: {
  icon: React.ElementType;
  iconTone: string;
  title: string;
  rows: [string, number][];
  cta: string;
  href: string;
}) {
  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", iconTone)}>
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-[17px] font-semibold text-text-primary">{title}</h3>

      <div className="flex flex-col gap-2.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between text-[13.5px]">
            <span className="text-text-secondary">{label}</span>
            <span className="font-semibold text-text-primary">{value}</span>
          </div>
        ))}
      </div>

      <a href={href}>
        <Button variant="dark" className="w-full">
          {cta} <ArrowRight className="h-4 w-4" />
        </Button>
      </a>
    </Card>
  );
}
