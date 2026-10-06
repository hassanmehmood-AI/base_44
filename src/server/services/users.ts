import { hash } from "bcryptjs";
import * as usersRepo from "@/server/repositories/users";
import * as accessRepo from "@/server/repositories/access";
import * as companiesRepo from "@/server/repositories/companies";
import * as managerAgentRepo from "@/server/repositories/managerAgentAssignments";
import { assertCompanyAccess, requireSession, UnauthorizedError } from "@/server/services/authorization";
import type { RoleKey, ModuleKey } from "@/server/constants";

export async function getAssignableUsersForCompany(companyId: string) {
  await assertCompanyAccess(companyId);
  return usersRepo.findAssignableForCompany(companyId);
}

/** CRM's "Assign Agent" dropdown specifically (hierarchy redesign phase 4)
 * — NOT a replacement for getAssignableUsersForCompany above, which Support
 * and Social Channels also call for their own assignee dropdowns and must
 * keep seeing the full company-wide list. Here, a Call Center Manager sees
 * only their own team (manager_agent_assignments) — "Manager should only
 * see agents who are under that manager." Every other role keeps today's
 * full assignable list, unchanged. */
export async function getAssignableAgentsForCrm(companyId: string) {
  const session = await assertCompanyAccess(companyId);
  if (session.user.roleKey === "CALL_CENTER_LEAD") {
    return usersRepo.findTeamForManager(session.user.id, companyId);
  }
  return usersRepo.findAssignableForCompany(companyId);
}

/** Call Center Managers available in this company — for the manager-
 * assignment dropdown (agent -> manager) and the campaign -> manager
 * dropdown. Read-only, so uses the same company-access gate as
 * getAssignableUsersForCompany (not restricted to Director/Superuser —
 * anyone who can see this company can see who manages it).
 *
 * Exception: a Call Center Manager only ever sees themselves here, never
 * their peers — they're only allowed to link an agent to themselves
 * (see setAgentManager), so showing other managers as options would just
 * be a dead end that setAgentManager rejects anyway. */
export async function getManagersForCompany(companyId: string) {
  const session = await assertCompanyAccess(companyId);
  if (session.user.roleKey === "CALL_CENTER_LEAD") {
    const self = await usersRepo.findById(session.user.id);
    return self ? [self] : [];
  }
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
 * one company. Director/Superuser can assign an agent to ANY manager in
 * that company (top-down reassignment). A Call Center Manager has a
 * narrower right: they may only claim an agent that is currently
 * unassigned (or already theirs), and only ever link it to *themselves* —
 * never hand an agent to a different manager, and never take an agent away
 * from another manager. That's what makes "Manager should be able to link
 * an agent under their own team" true without also granting general
 * reassignment power that belongs to Director/Superuser.
 *
 * Validates both ends server-side so a cross-company pairing is
 * structurally impossible, not just hidden in the UI: the agent must
 * actually hold CALL_CENTER_AGENT and have access to this company, and the
 * manager (when given) must hold CALL_CENTER_LEAD and have access to this
 * SAME company. */
export async function setAgentManager(input: SetAgentManagerInput): Promise<void> {
  const session = await assertCompanyAccess(input.companyId);

  if (session.user.roleKey === "CALL_CENTER_LEAD") {
    if (input.managerUserId !== null && input.managerUserId !== session.user.id) {
      throw new UnauthorizedError("You can only link agents to yourself.");
    }
    const current = await managerAgentRepo.findManagerForAgent(input.agentUserId, input.companyId);
    if (current && current.managerUserId !== session.user.id) {
      throw new UnauthorizedError("That agent is already assigned to another manager.");
    }
  } else if (session.user.roleKey !== "SUPERUSER" && session.user.roleKey !== "DIRECTOR") {
    // Director/Superuser fall through here with no extra check: Superuser's
    // bypass and a Director's own company grant are both already enforced
    // by assertCompanyAccess above (it's role-agnostic, so this branch is
    // what actually rejects everyone else -- Marketing, Agent, etc).
    throw new UnauthorizedError("You don't have permission to assign a manager.");
  }

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

/** Director's own Settings > Users list: every Call Center Manager and
 * Call Center Agent in their own company/companies -- never other
 * Directors, Superusers, or Marketing, and never another company's users.
 * Scoped from the session's own companyIds, never a client-supplied value. */
export async function listUsersForDirector() {
  const session = await requireSession();
  if (session.user.roleKey !== "DIRECTOR") throw new UnauthorizedError("Only Directors can use this.");
  return usersRepo.findUsersByRolesForCompanies(session.user.companyIds, ["CALL_CENTER_LEAD", "CALL_CENTER_AGENT"]);
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

/** Who may create which role, and for which company — the server-side
 * matrix (never trust the client's roleKey/companyIds for a non-Superuser
 * creator):
 *
 *  - Superuser: any role, any company (unchanged).
 *  - Director: CALL_CENTER_LEAD or CALL_CENTER_AGENT only, and ALWAYS for
 *    their own company/companies -- the client's companyIds is ignored
 *    entirely and replaced with the Director's own session.user.companyIds,
 *    so there is no way to request a different company.
 *  - Call Center Manager: CALL_CENTER_AGENT only, same ignore-the-client-
 *    input treatment for company.
 *  - everyone else: cannot create users at all.
 *
 * A Manager's newly created agent is also auto-linked to the Manager
 * themselves (manager_agent_assignments), so the agent is immediately
 * usable for assignment -- this is exactly the missing step that silently
 * broke Mazhar's setup earlier (an agent created but never linked to a
 * manager, invisible to the manager-scoped Assign Agent dropdown). */
function resolveCreateUserCompanyIds(session: Awaited<ReturnType<typeof requireSession>>, requestedRoleKey: RoleKey): string[] {
  const creatorRole = session.user.roleKey;

  if (creatorRole === "SUPERUSER") return []; // validated/looked-up below, from input.companyIds

  if (creatorRole === "DIRECTOR") {
    if (requestedRoleKey !== "CALL_CENTER_LEAD" && requestedRoleKey !== "CALL_CENTER_AGENT") {
      throw new UnauthorizedError("Directors can only create Call Center Managers or Call Center Agents.");
    }
    if (session.user.companyIds.length === 0) throw new Error("You don't have a company assigned.");
    return session.user.companyIds;
  }

  if (creatorRole === "CALL_CENTER_LEAD") {
    if (requestedRoleKey !== "CALL_CENTER_AGENT") {
      throw new UnauthorizedError("Managers can only create Call Center Agents.");
    }
    if (session.user.companyIds.length === 0) throw new Error("You don't have a company assigned.");
    return session.user.companyIds;
  }

  throw new UnauthorizedError("You don't have permission to add users.");
}

export async function createUser(input: CreateUserInput) {
  const session = await requireSession();
  const isSuperuserCreator = session.user.roleKey === "SUPERUSER";

  // Throws for any creator role that isn't allowed to make this roleKey at all.
  const forcedCompanyIds = resolveCreateUserCompanyIds(session, input.roleKey);

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
    const validCompanyIds = isSuperuserCreator
      ? input.companyIds.length
        ? (await companiesRepo.findByIds(input.companyIds)).map((c) => c.id)
        : []
      : forcedCompanyIds;
    await Promise.all([
      accessRepo.grantCompanyAccess(user.id, validCompanyIds),
      accessRepo.grantModuleAccess(user.id, input.modules),
    ]);

    if (session.user.roleKey === "CALL_CENTER_LEAD" && input.roleKey === "CALL_CENTER_AGENT") {
      await managerAgentRepo.setManagerForAgent(user.id, forcedCompanyIds[0], session.user.id);
    }
  }

  return user;
}
