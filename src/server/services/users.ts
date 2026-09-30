import * as usersRepo from "@/server/repositories/users";
import { assertCompanyAccess } from "@/server/services/authorization";

export async function getAssignableUsersForCompany(companyId: string) {
  await assertCompanyAccess(companyId);
  return usersRepo.findAssignableForCompany(companyId);
}
