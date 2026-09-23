"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { LanguageProvider } from "@/context/LanguageContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ColorThemeSwitcher } from "@/components/ColorThemeSwitcher";
import { DesignSystemSwitcher } from "@/components/DesignSystemSwitcher";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <ThemeProvider>
      <LanguageProvider>
        <div className="ds-shell flex h-screen w-full overflow-hidden">
          <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

          {mobileOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              onClick={() => setMobileOpen(false)}
              aria-hidden
            />
          )}

          <div className="flex min-w-0 flex-1 flex-col lg:pl-[96px] lg:transition-[padding-left] lg:duration-[850ms] lg:ease-[cubic-bezier(0.16,1,0.3,1)] lg:peer-hover:pl-[284px]">
            <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3 lg:hidden">
              <button
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted"
              >
                <Menu className="h-5 w-5" />
              </button>
              <span className="text-[15px] font-bold tracking-tight text-text-primary">GROWTH-ON</span>
            </header>

            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">{children}</div>
            </main>
          </div>
        </div>
        <ColorThemeSwitcher />
        <DesignSystemSwitcher />
      </LanguageProvider>
    </ThemeProvider>
  );
}
