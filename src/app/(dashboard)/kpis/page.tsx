import * as kpisService from "@/server/services/kpis";
import { getAllowedCompaniesForCurrentUser } from "@/server/services/companies";
import { KpisClient } from "./KpisClient";

export default async function KpisPage() {
  const [kpis, companies] = await Promise.all([
    kpisService.getKpisForCurrentUser(),
    getAllowedCompaniesForCurrentUser(),
  ]);

  return <KpisClient kpis={kpis} companies={companies} />;
}
