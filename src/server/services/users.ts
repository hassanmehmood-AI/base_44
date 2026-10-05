import { hash } from "bcryptjs";
import * as usersRepo from "@/server/repositories/users";
import * as accessRepo from "@/server/repositories/access";
import * as companiesRepo from "@/server/repositories/companies";
import { assertCompanyAccess, requireSession, UnauthorizedError } from "@/server/services/authorization";
import type { RoleKey, ModuleKey } from "@/server/constants";

export async function getAssignableUsersForCompany(companyId: string) {
  await assertCompanyAccess(companyId);
  return usersRepo.findAssignableForCompany(companyId);
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
