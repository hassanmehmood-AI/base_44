import { auth } from "@/auth";
import { getDefaultPipelineStages } from "@/server/services/pipelineStages";
import * as companiesRepo from "@/server/repositories/companies";
import * as usersService from "@/server/services/users";
import { ConfiguracionClient, type UserRow } from "./ConfiguracionClient";

export default async function ConfiguracionPage() {
  const [session, stages, companies] = await Promise.all([
    auth(),
    getDefaultPipelineStages(),
    companiesRepo.findAllActive(),
  ]);
  const isSuperuser = session?.user.roleKey === "SUPERUSER";
  const isDirector = session?.user.roleKey === "DIRECTOR";
  const isManager = session?.user.roleKey === "CALL_CENTER_LEAD";
  // Can this viewer create new users at all? Superuser (any), Director
  // (Managers/Agents, own company), Manager (Agents, own company) — see
  // usersService.createUser's matrix for the real, server-enforced rules.
  const canAddUsers = isSuperuser || isDirector || isManager;
  // Who may view/edit a user's company+module permissions (incl. "Reset by
  // role"): Superuser for anyone, Director for their own company's Managers
  // and Agents only — see usersService.assertCanManagePermissionsFor for the
  // actual enforced boundary; this flag only toggles the UI, the server call
  // is re-checked regardless.
  const canManagePermissions = isSuperuser || isDirector;

  let users: UserRow[];
  if (isSuperuser) {
    users = (await usersService.listUsers()).map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      roleKey: u.roleKey,
      isActive: u.isActive,
    }));
  } else if (isDirector) {
    // Every Manager/Agent in the Director's own company — never another company's users.
    users = (await usersService.listUsersForDirector()).map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      roleKey: u.roleKey,
      isActive: u.isActive,
    }));
  } else if (isManager && session!.user.companyIds[0]) {
    // Only the Manager's own linked team — not the whole company's roster.
    users = (await usersService.getManagerTeam(session!.user.id, session!.user.companyIds[0])).map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      roleKey: u.roleKey,
      isActive: u.isActive,
    }));
  } else {
    // Everyone else (Agent, Marketing, or a Manager with no company yet)
    // can't list other accounts at all — fall back to just themselves.
    users = session
      ? [{ id: session.user.id, fullName: session.user.name, email: session.user.email, roleKey: session.user.roleKey, isActive: true }]
      : [];
  }

  return (
    <ConfiguracionClient
      stages={stages}
      canManageStages={isSuperuser}
      companies={companies}
      canManageAdmin={isSuperuser}
      canAddUsers={canAddUsers}
      canManagePermissions={canManagePermissions}
      viewerRoleKey={session?.user.roleKey ?? "CALL_CENTER_AGENT"}
      // Director/Manager's own company, for the Manager/Team panels — a
      // Superuser viewer doesn't use this (they scope by the SELECTED
      // user's own company grants instead, fetched client-side).
      viewerCompanyId={session?.user.companyIds[0] ?? null}
      users={users}
      currentUserId={session?.user.id ?? ""}
    />
  );
}
