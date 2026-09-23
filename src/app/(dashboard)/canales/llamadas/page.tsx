"use client";

import { useState } from "react";
import { Phone, PhoneIncoming, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SearchInput, Select, Textarea } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { PageHeader } from "@/components/PageHeader";
import { useLanguage } from "@/context/LanguageContext";
import { callQueue } from "@/lib/mock-data";
import { cn } from "@/lib/cn";

export default function LlamadasPage() {
  const { t } = useLanguage();
  const [selectedId, setSelectedId] = useState(callQueue[0].id);
  const selected = callQueue.find((c) => c.id === selectedId) ?? callQueue[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Call Management", "Gestión de Llamadas")}
        subtitle={t("Call queue and results log", "Cola de llamadas y registro de resultados")}
        actions={
          <>
            <SearchInput placeholder={t("Search client, phone or email...", "Buscar cliente, teléfono o correo...")} className="max-w-sm" />
            <Button>
              <Phone className="h-4 w-4" /> {t("Start call", "Iniciar llamada")}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-[200px]">
          <Select defaultValue="All companies">
            <option>{t("All companies", "Todas las empresas")}</option>
            <option>Contact-On</option>
            <option>Leyva</option>
          </Select>
        </div>
        <Button variant="outline">
          <PhoneIncoming className="h-4 w-4" /> {t("Simulate incoming call", "Simular llamada entrante")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr_300px]">
        <Card className="flex flex-col gap-1 p-5">
          <div className="mb-2 flex items-center justify-between">
            <CardTitle>{t("Clients to call", "Clientes por llamar")}</CardTitle>
            <Badge tone="green">{callQueue.length} {t("in queue", "en cola")}</Badge>
          </div>
          <div className="flex flex-col gap-1 max-h-[560px] overflow-y-auto">
            {callQueue.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left transition-colors",
                  selectedId === c.id ? "bg-brand-50" : "hover:bg-surface-muted"
                )}
              >
                <Phone className="h-4 w-4 text-brand shrink-0" />
                <span className="truncate text-[13.5px] font-medium text-text-primary">{c.name}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col items-center gap-6 p-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <Avatar name={selected.name} size={56} />
            <p className="text-[18px] font-semibold text-text-primary">{selected.name}</p>
            <p className="text-[14px] text-text-secondary">{selected.phone}</p>
            <Badge tone="gray" className="mt-1">
              {t("Ready to call", "Listo para llamar")}
            </Badge>
          </div>

          <button className="flex h-16 w-16 items-center justify-center rounded-full bg-sidebar-active text-white shadow-lg shadow-brand/30 transition-transform hover:scale-105 hover:bg-[color-mix(in_srgb,var(--sidebar-active)_82%,black)]">
            <PhoneCall className="h-6 w-6" />
          </button>

          <div className="w-full border-t border-border pt-5">
            <p className="mb-3 text-[15px] font-semibold text-text-primary">{t("Activity history", "Historial de actividad")}</p>
            <div className="flex items-center justify-between rounded-xl border border-border p-3.5">
              <div>
                <p className="text-[13.5px] font-semibold text-text-primary">WhatsApp · {t("INTERESTED", "INTERESADO")}</p>
                <p className="text-[12px] text-text-secondary">{t("Agent", "Agente")}</p>
              </div>
              <span className="text-[12px] text-text-tertiary">{t("a month ago", "hace un mes")}</span>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <CardTitle>{t("Call result", "Resultado de llamada")}</CardTitle>

          <div className="flex justify-between text-[13.5px]">
            <span className="text-text-secondary">{t("Duration", "Duración")}</span>
            <span className="font-medium text-text-primary">—</span>
          </div>
          <div className="flex justify-between text-[13.5px]">
            <span className="text-text-secondary">{t("Time", "Hora")}</span>
            <span className="font-medium text-text-primary">
              {new Date().toLocaleDateString(t("en-US", "es-ES"), { day: "2-digit", month: "short" })}{" "}
              {new Date().toLocaleTimeString(t("en-US", "es-ES"), { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
              {t("COMMERCIAL STATUS", "ESTADO COMERCIAL")}
            </label>
            <Select defaultValue="NEW LEAD">
              <option>{t("NEW LEAD", "NUEVO LEAD")}</option>
              <option>{t("CONTACTED", "CONTACTADO")}</option>
              <option>{t("INTERESTED", "INTERESADO")}</option>
              <option>{t("CLIENT", "CLIENTE")}</option>
            </Select>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
              {t("NOTES", "NOTAS")}
            </label>
            <Textarea rows={3} placeholder={t("Call summary...", "Resumen de la llamada...")} />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
              {t("NEXT FOLLOW-UP", "PRÓXIMO SEGUIMIENTO")}
            </label>
            <input
              type="date"
              className="h-10 w-full rounded-lg border border-border bg-white px-3.5 text-[14px] text-text-primary outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>

          <Button className="mt-1 w-full">{t("Save result", "Guardar resultado")}</Button>
        </Card>
      </div>
    </div>
  );
}
