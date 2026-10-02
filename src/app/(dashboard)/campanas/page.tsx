import * as campaignsService from "@/server/services/campaigns";
import { getAllowedCompaniesForCurrentUser } from "@/server/services/companies";
import { CampanasClient } from "./CampanasClient";

export default async function CampanasPage() {
  const [campaigns, companies, stats] = await Promise.all([
    campaignsService.listCampaignsForCurrentUser(),
    getAllowedCompaniesForCurrentUser(),
    campaignsService.getCampaignPageStats(),
  ]);

  const initialSelectedCampaignId = campaigns[0]?.id ?? null;
  const initialMembers = initialSelectedCampaignId
    ? await campaignsService.getCampaignMembers(initialSelectedCampaignId)
    : [];

  return (
    <CampanasClient
      campaigns={campaigns}
      companies={companies}
      stats={stats}
      initialSelectedCampaignId={initialSelectedCampaignId}
      initialMembers={initialMembers}
    />
  );
}
