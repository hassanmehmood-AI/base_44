"use client";

import { useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SearchInput, Select } from "@/components/ui/Input";
import { StatCard } from "@/components/StatCard";
import { LeadsChart, type LeadsChartPoint } from "@/components/charts/LeadsChart";
import { useLanguage } from "@/context/LanguageContext";
import { useCompany, ALL_COMPANIES } from "@/context/CompanyContext";
import { toCsv, downloadTextFile } from "@/lib/csv";
import { cn } from "@/lib/cn";
import type { KpiCompanyTotals, KpiAgentRow, KpiMonthlyRow } from "@/server/services/kpis";
import { KPI_PERIODS, type KpiPeriod } from "@/server/constants";
import { getKpiTotalsForPeriodAction } from "./actions";

const PERIOD_LABEL: Record<KpiPeriod, string> = {
  ALL: "All time",
  MONTH: "This month",
  QUARTER: "This quarter",
  YEAR: "This year",
};
const PERIOD_LABEL_ES: Record<KpiPeriod, string> = {
  ALL: "Todo el tiempo",
  MONTH: "Este mes",
  QUARTER: "Este trimestre",
  YEAR: "Este año",
};

type CompanyOption = { id: string; name: string };

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

const MONTHLY_WINDOW_MONTHS = 6;

/** Fixed trailing-6-month axis, independent of which months happen to have
 * data for the currently selected company — mirrors the server's window in
 * services/kpis.ts. Keeping the axis fixed (rather than only showing months
 * that have rows) is what lets the chart animate smoothly between companies:
 * the same 6 bars resize in place instead of different bars appearing and
 * disappearing as the company filter changes. */
function trailingMonthKeys(count: number): string[] {
  const keys: string[] = [];
  const cursor = new Date();
  cursor.setDate(1);
  cursor.setMonth(cursor.getMonth() - (count - 1));
  for (let i = 0; i < count; i++) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

export function KpisClient({
  kpis,
  companies,
}: {
  kpis: { byCompany: KpiCompanyTotals[]; agents: KpiAgentRow[]; monthly: KpiMonthlyRow[] };
  companies: CompanyOption[];
}) {
  const { t, language } = useLanguage();
  const { activeCompany, setActiveCompany } = useCompany();
  const periodLabels = language === "es" ? PERIOD_LABEL_ES : PERIOD_LABEL;

  const [period, setPeriod] = useState<KpiPeriod>("ALL");
  const [periodData, setPeriodData] = useState<{ byCompany: KpiCompanyTotals[]; agents: KpiAgentRow[] } | null>(null);
  const [loadingPeriod, setLoadingPeriod] = useState(false);
  const requestIdRef = useRef(0);

  const byCompany = periodData?.byCompany ?? kpis.byCompany;
  const agents = periodData?.agents ?? kpis.agents;

  async function handlePeriodChange(next: KpiPeriod) {
    const requestId = ++requestIdRef.current;
    setPeriod(next);
    if (next === "ALL") {
      setPeriodData(null);
      setLoadingPeriod(false);
      return;
    }
    setLoadingPeriod(true);
    const result = await getKpiTotalsForPeriodAction(next);
    // Guard against an earlier, slower request resolving after a newer one —
    // only apply the response if no later period switch has happened since.
    if (requestIdRef.current !== requestId) return;
    setPeriodData(result);
    setLoadingPeriod(false);
  }

  const totals = useMemo(() => {
    const scoped = byCompany.filter((c) => activeCompany === ALL_COMPANIES || c.companyName === activeCompany);
    return scoped.reduce(
      (acc, c) => ({
        leadsWorked: acc.leadsWorked + c.leadsWorked,
        opportunities: acc.opportunities + c.opportunities,
        customers: acc.customers + c.customers,
      }),
      { leadsWorked: 0, opportunities: 0, customers: 0 }
    );
  }, [byCompany, activeCompany]);

  const filteredAgents = useMemo(
    () => agents.filter((a) => activeCompany === ALL_COMPANIES || a.companyName === activeCompany),
    [agents, activeCompany]
  );

  const monthlyChartData: LeadsChartPoint[] = useMemo(() => {
    const scoped = kpis.monthly.filter((m) => activeCompany === ALL_COMPANIES || m.companyName === activeCompany);
    const byMonth = new Map<string, { leads: number; conversiones: number }>();
    for (const row of scoped) {
      const bucket = byMonth.get(row.month) ?? { leads: 0, conversiones: 0 };
      bucket.leads += row.leads;
      bucket.conversiones += row.conversions;
      byMonth.set(row.month, bucket);
    }
    return trailingMonthKeys(MONTHLY_WINDOW_MONTHS).map((key) => ({
      month: monthLabel(key),
      ...(byMonth.get(key) ?? { leads: 0, conversiones: 0 }),
    }));
  }, [kpis.monthly, activeCompany]);

  function handleExport() {
    const rows: (string | number)[][] = [
      [t("Metric", "Métrica"), t("Value", "Valor")],
      [t("Company scope", "Alcance"), activeCompany === ALL_COMPANIES ? t("All companies", "Todas las empresas") : activeCompany],
      [t("Period", "Periodo"), periodLabels[period]],
      [t("Leads worked", "Leads trabajados"), totals.leadsWorked],
      [t("Opportunities generated", "Oportunidades generadas"), totals.opportunities],
      [t("Customers", "Clientes"), totals.customers],
      [t("Conversion rate (leads)", "Tasa de conversión (leads)"), pct(totals.customers, totals.leadsWorked)],
      [t("Conversion rate (opportunities)", "Tasa de conversión (oportunidades)"), pct(totals.customers, totals.opportunities)],
      [],
      [t("Month", "Mes"), t("Leads", "Leads"), t("Conversions", "Conversiones")],
      ...monthlyChartData.map((m) => [m.month, m.leads, m.conversiones]),
      [],
      [
        t("Agent", "Agente"),
        t("Company", "Empresa"),
        t("Assigned leads", "Leads asignados"),
        t("Contacted", "Contactados"),
        t("Opportunities", "Oportunidades"),
        t("Sales won", "Ventas ganadas"),
        t("Rate %", "Tasa %"),
      ],
      ...filteredAgents.map((a) => [
        a.userName,
        a.companyName,
        a.assigned,
        a.contacted,
        a.opportunities,
        a.sales,
        pct(a.sales, a.assigned),
      ]),
    ];

    const scopeSlug = activeCompany === ALL_COMPANIES ? "all-companies" : activeCompany.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const periodSlug = period.toLowerCase();
    const dateSlug = new Date().toISOString().slice(0, 10);
    downloadTextFile(toCsv(rows), `kpis-${scopeSlug}-${periodSlug}-${dateSlug}.csv`);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("KPI's", "KPI's")}
        subtitle={t("Departmental supervision and dynamic performance", "Supervisión departamental y rendimiento dinámico")}
      />

      <div className="flex flex-wrap items-end gap-3">
        <FilterField label={t("COMPANY", "EMPRESA")}>
          <Select value={activeCompany} onChange={(e) => setActiveCompany(e.target.value)}>
            <option value={ALL_COMPANIES}>{t("All companies", "Todas las empresas")}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label={t("DEPARTMENT", "DEPARTAMENTO")}>
          <Select defaultValue={t("Commercial", "Comercial")}>
            <option>{t("Commercial", "Comercial")}</option>
            <option>Marketing</option>
            <option>Call Center</option>
          </Select>
        </FilterField>
        <FilterField label={t("PERIOD", "PERIODO")}>
          <Select value={period} disabled={loadingPeriod} onChange={(e) => handlePeriodChange(e.target.value as KpiPeriod)}>
            {KPI_PERIODS.map((p) => (
              <option key={p} value={p}>
                {periodLabels[p]}
              </option>
            ))}
          </Select>
        </FilterField>

        {/* No metric-search backend exists for this fixed set of stat cards
            and the chart below — disabled rather than left looking
            functional with no actual filtering behind it. */}
        <SearchInput
          placeholder={t("Metric search not available", "Búsqueda de métricas no disponible")}
          className="max-w-xs"
          disabled
          title={t(
            "Metric search isn't available yet — use the Company and Period filters above to narrow these numbers.",
            "La búsqueda de métricas aún no está disponible: usa los filtros de Empresa y Periodo arriba para acotar estos datos."
          )}
        />
        <Button className="ml-auto" onClick={handleExport}>
          <Download className="h-4 w-4" /> {t("Export report", "Exportar informe")}
        </Button>
      </div>

      <div className={cn("grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-5 transition-opacity", loadingPeriod && "opacity-50")}>
        <StatCard label={t("Leads worked", "Leads trabajados")} value={totals.leadsWorked.toLocaleString("en-US")} />
        <StatCard label={t("Opportunities generated", "Oportunidades generadas")} value={totals.opportunities.toLocaleString("en-US")} />
        <StatCard label={t("Customers", "Clientes")} value={totals.customers.toLocaleString("en-US")} />
        <StatCard
          label={t("Conversion rate (leads)", "Tasa de conversión (leads)")}
          value={pct(totals.customers, totals.leadsWorked)}
          deltaSuffix={t("customers / leads worked", "clientes / leads trabajados")}
        />
        <StatCard
          label={t("Conversion rate (opportunities)", "Tasa de conversión (oportunidades)")}
          value={pct(totals.customers, totals.opportunities)}
          deltaSuffix={t("customers / opportunities", "clientes / oportunidades")}
        />
      </div>

      <Card className="p-6">
        <CardTitle>{t("Leads vs. Monthly Conversions", "Leads vs. Conversiones Mensuales")}</CardTitle>
        <div className="mt-4">
          <LeadsChart data={monthlyChartData} />
        </div>
      </Card>

      <Card className="p-6">
        <CardTitle>{t("Performance by commercial agent", "Rendimiento por agente comercial")}</CardTitle>
        <div className="mt-4 overflow-x-auto">
          {filteredAgents.length === 0 ? (
            <p className="py-6 text-center text-[13.5px] text-text-tertiary">
              {t("No assigned leads yet.", "Aún no hay leads asignados.")}
            </p>
          ) : (
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
                {filteredAgents.map((a) => (
                  <tr key={`${a.userId}:${a.companyId}`} className="border-t border-border text-[13.5px] transition-colors hover:bg-surface-muted/70">
                    <td className="py-3.5 pr-4 font-medium text-text-primary">{a.userName}</td>
                    <td className="py-3.5 pr-4 text-text-secondary">{a.assigned}</td>
                    <td className="py-3.5 pr-4 text-text-secondary">{a.contacted}</td>
                    <td className="py-3.5 pr-4 text-text-secondary">{a.opportunities}</td>
                    <td className="py-3.5 pr-4 text-text-secondary">{a.sales}</td>
                    <td className="py-3.5 font-medium text-brand-700">{pct(a.sales, a.assigned)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
