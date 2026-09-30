"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Menu, Undo2 } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { LanguageProvider } from "@/context/LanguageContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { CompanyProvider } from "@/context/CompanyContext";
import { useLanguage } from "@/context/LanguageContext";
import { stopImpersonationAction } from "@/app/(dashboard)/actions";
import type { ImpersonatableUser } from "@/components/UserSwitcher";
import type { RoleKey } from "@/server/constants";

type ShellUser = {
  name: string;
  roleKey: RoleKey;
  impersonatorId?: string;
  impersonatorName?: string;
};

function ImpersonationBanner({ user }: { user: ShellUser }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!user.impersonatorId) return null;

  function handleReturn() {
    startTransition(async () => {
      await stopImpersonationAction();
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-center gap-3 bg-warning-700 px-4 py-1.5 text-[13px] font-medium text-white">
      <span>
        {t("Viewing as", "Viendo como")} <strong>{user.name}</strong> — {t("switched by", "cambiado por")}{" "}
        {user.impersonatorName}
      </span>
      <button
        onClick={handleReturn}
        disabled={pending}
        className="flex items-center gap-1.5 rounded-md bg-white/15 px-2.5 py-1 font-semibold hover:bg-white/25 disabled:opacity-60"
      >
        <Undo2 className="h-3.5 w-3.5" />
        {t("Return to my account", "Volver a mi cuenta")}
      </button>
    </div>
  );
}

export function DashboardShell({
  user,
  companies,
  impersonatableUsers,
  children,
}: {
  user: ShellUser;
  companies: string[];
  impersonatableUsers: ImpersonatableUser[];
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <ThemeProvider>
      <LanguageProvider>
        <CompanyProvider companies={companies}>
          <div className="ds-shell flex h-screen w-full flex-col overflow-hidden">
            <ImpersonationBanner user={user} />
            <div className="flex min-w-0 flex-1 overflow-hidden">
              <Sidebar
                user={user}
                impersonatableUsers={impersonatableUsers}
                mobileOpen={mobileOpen}
                onClose={() => setMobileOpen(false)}
              />

              {mobileOpen && (
                <div
                  className="fixed inset-0 z-40 bg-black/50 lg:hidden"
                  onClick={() => setMobileOpen(false)}
                  aria-hidden
                />
              )}

              <div className="flex min-w-0 flex-1 flex-col lg:pl-[96px] lg:transition-[padding-left] lg:duration-[850ms] lg:ease-[cubic-bezier(0.16,1,0.3,1)] lg:peer-hover:pl-[284px]">
                <header className="flex items-center gap-3 bg-transparent px-4 py-3 lg:hidden">
                  <button
                    onClick={() => setMobileOpen(true)}
                    aria-label="Open menu"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                  <span className="text-[15px] font-bold tracking-tight text-text-primary">GROWTH-ON</span>
                </header>

                <TopBar />

                <main className="flex-1 overflow-y-auto">
                  <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">{children}</div>
                </main>
              </div>
            </div>
          </div>
        </CompanyProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
