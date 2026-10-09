import { hash } from "bcryptjs";
import * as usersRepo from "@/server/repositories/users";
import * as accessRepo from "@/server/repositories/access";
import * as companiesRepo from "@/server/repositories/companies";
import * as managerAgentRepo from "@/server/repositories/managerAgentAssignments";
import { assertCompanyAccess, requireSession, UnauthorizedError } from "@/server/services/authorization";
import { DEFAULT_MODULES_BY_ROLE, type RoleKey, type ModuleKey } from "@/server/constants";
import type { UserWithRole } from "@/server/repositories/users";

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

/** Authorization boundary shared by getUserAccess/updateUserPermissions/
 * resetUserPermissionsToRoleDefault: who may view or edit a target user's
 * company/module access.
 *  - Superuser: any target.
 *  - Director: only a CALL_CENTER_LEAD or CALL_CENTER_AGENT who already has
 *    access to one of the Director's own companies — never a peer Director,
 *    a Superuser, a Marketing user, or a user scoped to a company the
 *    Director doesn't have. Mirrors the same role pair createUser already
 *    lets a Director create.
 *  - Everyone else: no access.
 * `callerIsDirector` tells the caller whether company access may be touched
 * — only a Superuser may change which companies a user can reach; a
 * Director's own scope is itself company-bound, so they manage module
 * access only.
 */
async function assertCanManagePermissionsFor(userId: string): Promise<{ target: UserWithRole; callerIsDirector: boolean }> {
  const session = await requireSession();
  const target = await usersRepo.findById(userId);
  if (!target) throw new Error("User not found.");

  if (session.user.roleKey === "SUPERUSER") return { target, callerIsDirector: false };

  if (session.user.roleKey === "DIRECTOR") {
    if (target.roleKey !== "CALL_CENTER_LEAD" && target.roleKey !== "CALL_CENTER_AGENT") {
      throw new UnauthorizedError("Directors can only manage permissions for Call Center Managers or Agents.");
    }
    const targetCompanyIds = await accessRepo.findCompanyIdsForUser(userId);
    const sharesCompany = targetCompanyIds.some((id) => session.user.companyIds.includes(id));
    if (!sharesCompany) throw new UnauthorizedError("You can only manage permissions for users in your own company.");
    return { target, callerIsDirector: true };
  }

  throw new UnauthorizedError("Only Superusers and Directors can manage permissions.");
}

export async function getUserAccess(userId: string) {
  const { target } = await assertCanManagePermissionsFor(userId);
  if (target.roleKey === "SUPERUSER") return { companyIds: [], modules: [] as ModuleKey[], isSuperuser: true };

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
  const { target, callerIsDirector } = await assertCanManagePermissionsFor(input.userId);
  if (target.roleKey === "SUPERUSER") {
    throw new Error("Superusers have implicit access to every company and module and cannot be edited.");
  }

  await accessRepo.replaceModuleAccess(input.userId, input.modules);

  if (!callerIsDirector) {
    const validCompanyIds = input.companyIds.length
      ? (await companiesRepo.findByIds(input.companyIds)).map((c) => c.id)
      : [];
    await accessRepo.replaceCompanyAccess(input.userId, validCompanyIds);
  }
}

/** "Reset by role" — overwrites the target's module grants with the
 * approved baseline for their role (see DEFAULT_MODULES_BY_ROLE). Deliberately
 * leaves company access, assigned contacts, and every other record
 * untouched — this resets what they can SEE inside a company they already
 * have, not which companies or clients they have. Same authorization
 * boundary as updateUserPermissions (Superuser: anyone; Director: their own
 * company's Managers/Agents only). Returns the applied module list so the
 * caller can update its UI without a second round trip. */
export async function resetUserPermissionsToRoleDefault(userId: string): Promise<ModuleKey[]> {
  const { target } = await assertCanManagePermissionsFor(userId);
  if (target.roleKey === "SUPERUSER") {
    throw new Error("Superusers have implicit access to every company and module and cannot be edited.");
  }
  const defaults = DEFAULT_MODULES_BY_ROLE[target.roleKey];
  await accessRepo.replaceModuleAccess(userId, defaults);
  return defaults;
}

export async function deactivateUser(userId: string) {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") throw new UnauthorizedError("Only Superusers can delete users.");
  if (session.user.id === userId) throw new Error("You cannot delete your own account.");

  const user = await usersRepo.findById(userId);
  if (!user) throw new Error("User not found.");
  await usersRepo.setActive(userId, false);
}

/** Changes an existing user's role. Mirrors the other admin-on-user actions
 * above (Superuser-only, can't target yourself — same restriction and same
 * error-message style as deactivateUser).
 *
 * Deliberate scope, resolved here rather than left open:
 *  - Company/module access is left untouched. A role change doesn't imply
 *    the admin wants access re-scoped, and guessing new defaults risks
 *    silently granting or revoking access nobody asked for — if access
 *    needs to change too, that's still a separate, explicit step via
 *    updateUserPermissions.
 *  - manager_agent_assignments rows ARE cleaned up (link removed, never the
 *    agent's assigned contacts/history) when a user stops being a
 *    CALL_CENTER_AGENT or CALL_CENTER_LEAD: unlike company/module access,
 *    those rows aren't a standing grant the admin configured — they only
 *    mean anything while both ends still hold the role they had when
 *    linked. findTeamForManager/findManyByManagerScope read this table
 *    directly without re-checking either side's current role, so a stale
 *    row would keep surfacing a demoted agent in a team/CRM scope, or keep
 *    a demoted manager's old team pointed at them.
 *  - Blocks demoting the very last active Superuser, so this can't be used
 *    to lock everyone out of admin access.
 */
export async function updateUserRole(userId: string, newRoleKey: RoleKey): Promise<void> {
  const session = await requireSession();
  if (session.user.roleKey !== "SUPERUSER") throw new UnauthorizedError("Only Superusers can change roles.");
  if (session.user.id === userId) throw new Error("You cannot change your own role.");

  const user = await usersRepo.findById(userId);
  if (!user) throw new Error("User not found.");
  if (user.roleKey === newRoleKey) return;

  if (user.roleKey === "SUPERUSER") {
    const allUsers = await usersRepo.findAll();
    const activeSuperusers = allUsers.filter((u) => u.roleKey === "SUPERUSER" && u.isActive);
    if (activeSuperusers.length <= 1) throw new Error("Cannot change the role of the last Superuser.");
  }

  const roleId = await usersRepo.findRoleIdByKey(newRoleKey);
  if (!roleId) throw new Error("Unknown role.");
  await usersRepo.setRole(userId, roleId);

  if (user.roleKey === "CALL_CENTER_AGENT" && newRoleKey !== "CALL_CENTER_AGENT") {
    await managerAgentRepo.removeAllAssignmentsForAgent(userId);
  }
  if (user.roleKey === "CALL_CENTER_LEAD" && newRoleKey !== "CALL_CENTER_LEAD") {
    await managerAgentRepo.removeAllAssignmentsForManager(userId);
  }
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
