import { auth } from "@/auth";
import { getDefaultPipelineStages } from "@/server/services/pipelineStages";
import { ConfiguracionClient } from "./ConfiguracionClient";

export default async function ConfiguracionPage() {
  const [session, stages] = await Promise.all([auth(), getDefaultPipelineStages()]);
  const canManageStages = session?.user.roleKey === "SUPERUSER";

  return <ConfiguracionClient stages={stages} canManageStages={canManageStages} />;
}
