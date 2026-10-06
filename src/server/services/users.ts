import { hash } from "bcryptjs";
import * as usersRepo from "@/server/repositories/users";
import * as accessRepo from "@/server/repositories/access";
import * as companiesRepo from "@/server/repositories/companies";
import * as managerAgentRepo from "@/server/repositories/managerAgentAssignments";
import { assertCompanyAccess, assertDirectorOrSuperuser, requireSession, UnauthorizedError } from "@/server/services/authorization";
import type { RoleKey, ModuleKey } from "@/server/constants";

export async function getAssignableUsersForCompany(companyId: string) {
  await assertCompanyAccess(companyId);
  return usersRepo.findAssignableForCompany(companyId);
}

/** Call Center Managers available in this company — for the manager-
 * assignment dropdown (agent -> manager) and, later, the campaign ->
 * manager dropdown. Read-only, so uses the same company-access gate as
 * getAssignableUsersForCompany (not restricted to Director/Superuser —
 * anyone who can see this company can see who manages it). */
export async function getManagersForCompany(companyId: string) {
  await assertCompanyAccess(companyId);
  return usersRepo.findUsersByRoleForCompany(companyId, "CALL_CENTER_LEAD");
}

/** The manager currently linked to this agent in this company, or null. */
export async function getAgentManager(agentUserId: string, companyId: string): Promise<string | null> {
  await assertCompanyAccess(companyId);
  const row = await managerAgentRepo.findManagerForAgent(agentUserId, companyId);
  return row?.managerUserId ?? null;
}

/** This manager's team in this company — what the admin UI's "Team"
 * read-out shows, and what the manager-scoped Assign Agent dropdown and
 * Auto Assign Leads (later phases) will draw their eligible agents from. */
export async function getManagerTeam(managerUserId: string, companyId: string) {
  await assertCompanyAccess(companyId);
  return usersRepo.findTeamForManager(managerUserId, companyId);
}

export type SetAgentManagerInput = { agentUserId: string; companyId: string; managerUserId: string | null };

/** Links (or, with managerUserId null, unlinks) an agent to a manager within
 * one company. Restricted to that company's Director or a Superuser —
 * never the Manager/Agent themselves — matching the hierarchy's top-down
 * assignment model. Validates both ends server-side so a cross-company
 * pairing is structurally impossible, not just hidden in the UI: the agent
 * must actually hold CALL_CENTER_AGENT and have access to this company, and
 * the manager (when given) must hold CALL_CENTER_LEAD and have access to
 * this SAME company. */
export async function setAgentManager(input: SetAgentManagerInput): Promise<void> {
  await assertDirectorOrSuperuser(input.companyId);

  const agent = await usersRepo.findById(input.agentUserId);
  if (!agent || agent.roleKey !== "CALL_CENTER_AGENT") throw new Error("Target user is not a Call Center Agent.");
  const agentCompanyIds = await accessRepo.findCompanyIdsForUser(input.agentUserId);
  if (!agentCompanyIds.includes(input.companyId)) throw new Error("That agent does not have access to this company.");

  if (input.managerUserId === null) {
    await managerAgentRepo.removeManagerForAgent(input.agentUserId, input.companyId);
    return;
  }

  const manager = await usersRepo.findById(input.managerUserId);
  if (!manager || manager.roleKey !== "CALL_CENTER_LEAD") throw new Error("Target manager is not a Call Center Manager.");
  const managerCompanyIds = await accessRepo.findCompanyIdsForUser(input.managerUserId);
  if (!managerCompanyIds.includes(input.companyId)) throw new Error("That manager does not have access to this company.");

  await managerAgentRepo.setManagerForAgent(input.agentUserId, input.companyId, input.managerUserId);
}

export async function listUsers() {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") throw new UnauthorizedError("Only Superusers can view all users.");
  return usersRepo.findAll();
}

export async function getUserAccess(userId: string) {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") throw new UnauthorizedError("Only Superusers can view user permissions.");

  const user = await usersRepo.findById(userId);
  if (!user) throw new Error("User not found.");
  if (user.roleKey === "SUPERUSER") return { companyIds: [], modules: [] as ModuleKey[], isSuperuser: true };

  const [companyIds, modules] = await Promise.all([
    accessRepo.findCompanyIdsForUser(userId),
    accessRepo.findModulesForUser(userId),
  ]);
  return { companyIds, modules: modules as ModuleKey[], isSuperuser: false };
}

export type UpdateUserPermissionsInput = {
  userId: string;
  companyIds: string[];
  modules: ModuleKey[];
};

export async function updateUserPermissions(input: UpdateUserPermissionsInput) {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") throw new UnauthorizedError("Only Superusers can edit permissions.");

  const user = await usersRepo.findById(input.userId);
  if (!user) throw new Error("User not found.");
  if (user.roleKey === "SUPERUSER") {
    throw new Error("Superusers have implicit access to every company and module and cannot be edited.");
  }

  const validCompanyIds = input.companyIds.length
    ? (await companiesRepo.findByIds(input.companyIds)).map((c) => c.id)
    : [];
  await accessRepo.replaceCompanyAccess(input.userId, validCompanyIds);
  await accessRepo.replaceModuleAccess(input.userId, input.modules);
}

export async function deactivateUser(userId: string) {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") throw new UnauthorizedError("Only Superusers can delete users.");
  if (session.user.id === userId) throw new Error("You cannot delete your own account.");

  const user = await usersRepo.findById(userId);
  if (!user) throw new Error("User not found.");
  await usersRepo.setActive(userId, false);
}

export type CreateUserInput = {
  fullName: string;
  email: string;
  password: string;
  roleKey: RoleKey;
  // Ignored for SUPERUSER — that role has implicit access to every company/module (see authorization.ts).
  companyIds: string[];
  modules: ModuleKey[];
};

export async function createUser(input: CreateUserInput) {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") throw new UnauthorizedError("Only Superusers can add users.");

  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  if (!fullName) throw new Error("Full name is required.");
  if (!email) throw new Error("Email is required.");
  if (input.password.length < 8) throw new Error("Password must be at least 8 characters.");
  if (await usersRepo.existsByEmail(email)) throw new Error("A user with that email already exists.");

  const roleId = await usersRepo.findRoleIdByKey(input.roleKey);
  if (!roleId) throw new Error("Unknown role.");

  const passwordHash = await hash(input.password, 12);
  const user = await usersRepo.create({ fullName, email, passwordHash, roleId });

  if (input.roleKey !== "SUPERUSER") {
    const validCompanyIds = input.companyIds.length
      ? (await companiesRepo.findByIds(input.companyIds)).map((c) => c.id)
      : [];
    await Promise.all([
      accessRepo.grantCompanyAccess(user.id, validCompanyIds),
      accessRepo.grantModuleAccess(user.id, input.modules),
    ]);
  }

  return user;
}
