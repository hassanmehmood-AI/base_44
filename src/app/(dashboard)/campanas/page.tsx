import { auth } from "@/auth";
import * as campaignsService from "@/server/services/campaigns";
import { getAllowedCompaniesForCurrentUser } from "@/server/services/companies";
import { CampanasClient } from "./CampanasClient";

export default async function CampanasPage() {
  const [session, campaigns, companies, stats] = await Promise.all([
    auth(),
    campaignsService.listCampaignsForCurrentUser(),
    getAllowedCompaniesForCurrentUser(),
    campaignsService.getCampaignPageStats(),
  ]);

  const initialSelectedCampaignId = campaigns[0]?.id ?? null;
  const initialMembers = initialSelectedCampaignId
    ? await campaignsService.getCampaignMembers(initialSelectedCampaignId)
    : [];

  // Only a Director/Superuser may reassign a campaign's manager — matches
  // the server-side assertDirectorOrSuperuser check in reassignCampaignManager.
  const canAssignManager = session?.user.roleKey === "SUPERUSER" || session?.user.roleKey === "DIRECTOR";

  return (
    <CampanasClient
      campaigns={campaigns}
      companies={companies}
      stats={stats}
      initialSelectedCampaignId={initialSelectedCampaignId}
      initialMembers={initialMembers}
      canAssignManager={canAssignManager}
    />
  );
}
