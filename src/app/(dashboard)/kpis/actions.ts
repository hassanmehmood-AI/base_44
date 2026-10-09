"use server";

import * as kpisService from "@/server/services/kpis";
import type { KpiPeriod, KpiDepartment } from "@/server/constants";

export async function getKpiDashboardAction(period: KpiPeriod, department: KpiDepartment) {
  const [totals, monthly] = await Promise.all([
    kpisService.getKpiTotals(period, department),
    kpisService.getKpiMonthlyTrend(department),
  ]);
  return { ...totals, monthly };
}
