"use client";

import { useState } from "react";
import { UploadCloud, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SearchInput, Select } from "@/components/ui/Input";
import { StatCard } from "@/components/StatCard";
import { StageBadge } from "@/components/StageBadge";
import { useLanguage } from "@/context/LanguageContext";
import { campaignStats, databases, campaignRows, campaignFilters } from "@/lib/mock-data";

const stageKeyByLabel: Record<string, string> = {
  Interested: "INTERESADO",
  "To contact": "POR_CONTACTAR",
  "Order placed": "PEDIDO_REALIZADO",
};

export default function CampanasPage() {
  const { t } = useLanguage();
  const [canalChecked, setCanalChecked] = useState<Set<string>>(new Set());
  const [agenteChecked, setAgenteChecked] = useState<Set<string>>(new Set());

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, value: string) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  const anyFilterActive = canalChecked.size > 0 || agenteChecked.size > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("Manage Campaigns", "Gestionar Campañas")}
        subtitle={t(
          "Import databases and manage team prospecting",
          "Importa bases de datos y gestiona la prospección del equipo"
        )}
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("Total contacts", "Contactos totales")}
          value={campaignStats.contactosTotales.toLocaleString("en-US")}
          delta={campaignStats.contactosDelta}
        />
        <StatCard
          label={t("Contacted", "Contactados")}
          value={campaignStats.contactados.toLocaleString("en-US")}
          delta={campaignStats.contactadosPct}
        />
        <StatCard
          label={t("Sign-ups generated", "Altas generadas")}
          value={String(campaignStats.altasGeneradas)}
          delta={campaignStats.altasPct}
        />
        <StatCard
          label={t("Opportunities", "Oportunidades")}
          value={String(campaignStats.oportunidades)}
          delta={campaignStats.oportunidadesDelta}
          deltaSuffix={t("this week", "esta semana")}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr_280px]">
        {/* Databases */}
        <Card className="flex flex-col gap-4 p-5">
          <CardHeader>
            <CardTitle>{t("Databases", "Bases de datos")}</CardTitle>
            <Badge tone="green">{databases.length} {t("active", "activas")}</Badge>
          </CardHeader>

          <button className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-8 text-center transition-colors hover:border-brand hover:bg-brand-50/40">
            <UploadCloud className="h-6 w-6 text-brand" />
            <span className="text-[14px] font-semibold text-text-primary">
              {t("Import Excel or CSV", "Importar Excel o CSV")}
            </span>
            <span className="text-[12.5px] text-text-secondary">
              {t("Drag a file or click here", "Arrastra un archivo o haz clic aquí")}
            </span>
          </button>

          <div className="flex flex-col gap-3">
            {databases.map((db) => (
              <div key={db.id} className="rounded-xl border border-border p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[14px] font-semibold text-text-primary">{db.name}</p>
                  <span className="shrink-0 text-[12px] text-text-secondary">
                    {db.records} {t("records", "registros")}
                  </span>
                </div>
                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${db.progress}%` }}
                  />
                </div>
                <p className="mt-1.5 text-right text-[12px] font-medium text-brand-700">
                  {db.progress}%
                </p>
              </div>
            ))}
          </div>
        </Card>

        {/* Client Prospecting table */}
        <Card className="flex flex-col gap-4 p-5">
          <CardHeader>
            <CardTitle>{t("Client Prospecting", "Prospección de clientes")}</CardTitle>
          </CardHeader>

          <div className="flex flex-wrap gap-3">
            <SearchInput placeholder={t("Search...", "Buscar...")} />
            <Button>{t("Assign", "Asignar")}</Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="text-[11px] font-semibold tracking-wide text-text-tertiary">
                  <th className="pb-3 pr-4">{t("CLIENT", "CLIENTE")}</th>
                  <th className="pb-3 pr-4">{t("AGENT", "AGENTE")}</th>
                  <th className="pb-3 pr-4">{t("CHANNEL", "CANAL")}</th>
                  <th className="pb-3 pr-4">{t("STATUS", "ESTADO")}</th>
                  <th className="pb-3">{t("LAST CONTACT", "ÚLTIMO CONTACTO")}</th>
                </tr>
              </thead>
              <tbody>
                {campaignRows.map((row) => (
                  <tr key={row.id} className="border-t border-border text-[13.5px] transition-colors hover:bg-surface-muted/70">
                    <td className="py-3.5 pr-4 font-medium text-text-primary">{row.cliente}</td>
                    <td className="py-3.5 pr-4 text-text-secondary">{row.agente}</td>
                    <td className="py-3.5 pr-4 text-text-secondary">{row.canal}</td>
                    <td className="py-3.5 pr-4">
                      <StageBadge stage={stageKeyByLabel[row.estado] ?? row.estado} />
                    </td>
                    <td className="py-3.5 text-text-secondary">{row.ultimo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Filters */}
        <Card className="flex flex-col gap-5 p-5">
          <CardHeader>
            <CardTitle>{t("Filters", "Filtros")}</CardTitle>
            {anyFilterActive && (
              <button
                onClick={() => {
                  setCanalChecked(new Set());
                  setAgenteChecked(new Set());
                }}
                className="flex items-center gap-1 text-[12.5px] font-medium text-text-secondary hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" /> {t("Clear", "Limpiar")}
              </button>
            )}
          </CardHeader>

          <div>
            <p className="mb-2.5 text-[11px] font-semibold tracking-wide text-text-tertiary">
              {t("CHANNEL", "CANAL")}
            </p>
            <div className="flex flex-col gap-2.5">
              {campaignFilters.canal.map((f) => (
                <label key={f.label} className="flex cursor-pointer items-center justify-between text-[13.5px]">
                  <span className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={canalChecked.has(f.label)}
                      onChange={() => toggle(canalChecked, setCanalChecked, f.label)}
                    />
                    {f.label}
                  </span>
                  <span className="text-text-tertiary">{f.count}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2.5 text-[11px] font-semibold tracking-wide text-text-tertiary">
              {t("COMMERCIAL AGENT", "AGENTE COMERCIAL")}
            </p>
            <div className="flex flex-col gap-2.5">
              {campaignFilters.agente.map((f) => (
                <label key={f.label} className="flex cursor-pointer items-center justify-between text-[13.5px]">
                  <span className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      checked={agenteChecked.has(f.label)}
                      onChange={() => toggle(agenteChecked, setAgenteChecked, f.label)}
                    />
                    {f.label}
                  </span>
                  <span className="text-text-tertiary">{f.count}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-text-tertiary">
              {t("STATUS", "ESTADO")}
            </p>
            <Select defaultValue="All statuses">
              <option>{t("All statuses", "Todos los estados")}</option>
              <option>{t("New lead", "Nuevo lead")}</option>
              <option>{t("Contacted", "Contactado")}</option>
              <option>{t("Interested", "Interesado")}</option>
              <option>{t("Client", "Cliente")}</option>
            </Select>
          </div>
        </Card>
      </div>
    </div>
  );
}
