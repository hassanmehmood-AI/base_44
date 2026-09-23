"use client";

import { Sidebar } from "@/components/Sidebar";
import { LanguageProvider } from "@/context/LanguageContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ColorThemeSwitcher } from "@/components/ColorThemeSwitcher";
import { DesignSystemSwitcher } from "@/components/DesignSystemSwitcher";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <div className="ds-shell flex h-screen w-full overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto pl-[96px] transition-[padding-left] duration-[850ms] ease-[cubic-bezier(0.16,1,0.3,1)] peer-hover:pl-[284px]">
            <div className="mx-auto max-w-[1600px] px-8 py-8">{children}</div>
          </main>
        </div>
        <ColorThemeSwitcher />
        <DesignSystemSwitcher />
      </LanguageProvider>
    </ThemeProvider>
  );
}
