import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAllowedCompanyNamesForCurrentUser } from "@/server/services/companies";
import { getImpersonatableUsersAction } from "@/app/(dashboard)/actions";
import { DashboardShell } from "@/components/DashboardShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // proxy.ts already redirects unauthenticated requests, but per Next.js's own
  // guidance a proxy matcher change shouldn't be the only thing standing between
  // a page and an unauthenticated request — check again here.
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [companies, { users: impersonatableUsers }] = await Promise.all([
    getAllowedCompanyNamesForCurrentUser(),
    getImpersonatableUsersAction(),
  ]);

  return (
    <DashboardShell
      user={{
        id: session.user.id,
        name: session.user.name,
        roleKey: session.user.roleKey,
        impersonatorId: session.user.impersonatorId,
        impersonatorName: session.user.impersonatorName,
      }}
      companies={companies}
      impersonatableUsers={impersonatableUsers}
    >
      {children}
    </DashboardShell>
  );
}
