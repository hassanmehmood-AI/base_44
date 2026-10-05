import { auth } from "@/auth";
import { getDefaultPipelineStages } from "@/server/services/pipelineStages";
import * as companiesRepo from "@/server/repositories/companies";
import * as usersService from "@/server/services/users";
import { ConfiguracionClient } from "./ConfiguracionClient";

export default async function ConfiguracionPage() {
  const [session, stages, companies] = await Promise.all([
    auth(),
    getDefaultPipelineStages(),
    companiesRepo.findAllActive(),
  ]);
  const isSuperuser = session?.user.roleKey === "SUPERUSER";

  // Non-Superusers can't list every account (service-layer gate) — fall back to just themselves.
  const users = isSuperuser
    ? (await usersService.listUsers()).map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        roleKey: u.roleKey,
        isActive: u.isActive,
      }))
    : session
      ? [{ id: session.user.id, fullName: session.user.name, email: session.user.email, roleKey: session.user.roleKey, isActive: true }]
      : [];

  return (
    <ConfiguracionClient
      stages={stages}
      canManageStages={isSuperuser}
      companies={companies}
      canManageAdmin={isSuperuser}
      users={users}
      currentUserId={session?.user.id ?? ""}
    />
  );
}
