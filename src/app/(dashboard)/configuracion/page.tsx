import { auth } from "@/auth";
import { getDefaultPipelineStages } from "@/server/services/pipelineStages";
import * as companiesRepo from "@/server/repositories/companies";
import { ConfiguracionClient } from "./ConfiguracionClient";

export default async function ConfiguracionPage() {
  const [session, stages, companies] = await Promise.all([
    auth(),
    getDefaultPipelineStages(),
    companiesRepo.findAllActive(),
  ]);
  const isSuperuser = session?.user.roleKey === "SUPERUSER";

  return (
    <ConfiguracionClient
      stages={stages}
      canManageStages={isSuperuser}
      companies={companies}
      canManageAdmin={isSuperuser}
    />
  );
}
