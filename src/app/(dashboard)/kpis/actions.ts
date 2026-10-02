"use server";

import * as kpisService from "@/server/services/kpis";
import type { KpiPeriod } from "@/server/constants";

export async function getKpiTotalsForPeriodAction(period: KpiPeriod) {
  return kpisService.getKpiTotals(period);
}
