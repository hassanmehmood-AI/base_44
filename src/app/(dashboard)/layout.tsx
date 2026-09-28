import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAllowedCompanyNamesForCurrentUser } from "@/server/services/companies";
import { DashboardShell } from "@/components/DashboardShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // proxy.ts already redirects unauthenticated requests, but per Next.js's own
  // guidance a proxy matcher change shouldn't be the only thing standing between
  // a page and an unauthenticated request — check again here.
  const session = await auth();
  if (!session?.user) redirect("/login");

  const companies = await getAllowedCompanyNamesForCurrentUser();

  return (
    <DashboardShell user={{ name: session.user.name, roleKey: session.user.roleKey }} companies={companies}>
      {children}
    </DashboardShell>
  );
}
