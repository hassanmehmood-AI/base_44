import { auth } from "@/auth";
import * as activeCampaignsService from "@/server/services/activeCampaigns";
import { getAllowedCompaniesForCurrentUser } from "@/server/services/companies";
import { getActiveDefaultPipelineStages } from "@/server/services/pipelineStages";
import { CampanasActivasClient } from "./CampanasActivasClient";

export default async function CampanasActivasPage() {
  const [session, companies, clients, channelSummary, stages] = await Promise.all([
    auth(),
    getAllowedCompaniesForCurrentUser(),
    activeCampaignsService.getAssignedClientsForCurrentUser(),
    activeCampaignsService.getChannelSummaryForCurrentUser(),
    getActiveDefaultPipelineStages(),
  ]);

  return (
    <CampanasActivasClient
      companies={companies}
      clients={clients}
      channelSummary={channelSummary}
      entryStageId={stages[0]?.id ?? null}
      currentUserName={session?.user.name ?? null}
    />
  );
}
