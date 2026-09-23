"use client";

import { Download } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SearchInput, Select } from "@/components/ui/Input";
import { StatCard } from "@/components/StatCard";
import { LeadsChart } from "@/components/charts/LeadsChart";
import { useLanguage } from "@/context/LanguageContext";
import { kpiStats, agentPerformance } from "@/lib/mock-data";

export default function KpisPage() {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("KPI's", "KPI's")}
        subtitle={t("Departmental supervision and dynamic performance", "Supervisión departamental y rendimiento dinámico")}
      />

      <div className="flex flex-wrap items-end gap-3">
        <FilterField label={t("COMPANY", "EMPRESA")}>
          <Select defaultValue={t("All companies", "Todas las empresas")}>
            <option>{t("All companies", "Todas las empresas")}</option>
            <option>Contact-On</option>
            <option>Leyva</option>
          </Select>
        </FilterField>
        <FilterField label={t("DEPARTMENT", "DEPARTAMENTO")}>
          <Select defaultValue={t("Commercial", "Comercial")}>
            <option>{t("Commercial", "Comercial")}</option>
            <option>Marketing</option>
            <option>Call Center</option>
          </Select>
        </FilterField>
        <FilterField label={t("AGENT / USER", "AGENTE / USUARIO")}>
          <Select defaultValue={t("Entire team", "Toda la plantilla")}>
            <option>{t("Entire team", "Toda la plantilla")}</option>
            <option>David Leyva</option>
            <option>Milagros</option>
          </Select>
        </FilterField>
        <FilterField label={t("PERIOD", "PERIODO")}>
          <Select defaultValue={t("This month", "Este mes")}>
            <option>{t("This month", "Este mes")}</option>
            <option>{t("This quarter", "Este trimestre")}</option>
            <option>{t("This year", "Este año")}</option>
          </Select>
        </FilterField>

        <SearchInput placeholder={t("Search metric...", "Buscar métrica...")} className="max-w-xs" />
        <Button className="ml-auto">
          <Download className="h-4 w-4" /> {t("Export report", "Exportar informe")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("Leads worked", "Leads trabajados")} value={kpiStats.leadsTrabajados.value} delta={kpiStats.leadsTrabajados.delta} />
        <StatCard label={t("Opportunities generated", "Oportunidades generadas")} value={kpiStats.oportunidades.value} delta={kpiStats.oportunidades.delta} />
        <StatCard label={t("Conversions / Sales", "Conversiones / Ventas")} value={kpiStats.conversiones.value} delta={kpiStats.conversiones.delta} />
        <StatCard label={t("Conversion rate", "Tasa de conversión")} value={kpiStats.tasaConversion.value} delta={kpiStats.tasaConversion.delta} />
      </div>

      <Card className="p-6">
        <CardTitle>{t("Leads vs. Monthly Conversions", "Leads vs. Conversiones Mensuales")}</CardTitle>
        <div className="mt-4">
          <LeadsChart />
        </div>
      </Card>

      <Card className="p-6">
        <CardTitle>{t("Performance by commercial agent", "Rendimiento por agente comercial")}</CardTitle>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="text-[11px] font-semibold tracking-wide text-text-tertiary">
                <th className="pb-3 pr-4">{t("AGENT", "AGENTE")}</th>
                <th className="pb-3 pr-4">{t("ASSIGNED LEADS", "LEADS ASIGNADOS")}</th>
                <th className="pb-3 pr-4">{t("CONTACTED", "CONTACTADOS")}</th>
                <th className="pb-3 pr-4">{t("OPPORTUNITIES", "OPORTUNIDADES")}</th>
                <th className="pb-3 pr-4">{t("SALES WON", "VENTAS GANADAS")}</th>
                <th className="pb-3">{t("RATE %", "TASA %")}</th>
              </tr>
            </thead>
            <tbody>
              {agentPerformance.map((a) => (
                <tr key={a.agente} className="border-t border-border text-[13.5px] transition-colors hover:bg-surface-muted/70">
                  <td className="py-3.5 pr-4 font-medium text-text-primary">{a.agente}</td>
                  <td className="py-3.5 pr-4 text-text-secondary">{a.asignados}</td>
                  <td className="py-3.5 pr-4 text-text-secondary">{a.contactados}</td>
                  <td className="py-3.5 pr-4 text-text-secondary">{a.oportunidades}</td>
                  <td className="py-3.5 pr-4 text-text-secondary">{a.ventas}</td>
                  <td className="py-3.5 font-medium text-brand-700">{a.tasa}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="w-[190px]">
      <label className="mb-1.5 block text-[11px] font-semibold tracking-wide text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}
