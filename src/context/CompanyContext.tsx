"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export const ALL_COMPANIES = "all" as const;
export type CompanyId = string | typeof ALL_COMPANIES;

const STORAGE_KEY = "crm-active-company";

interface CompanyContextValue {
  companies: string[];
  activeCompany: CompanyId;
  setActiveCompany: (company: CompanyId) => void;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({
  companies,
  children,
}: {
  /** Names of the companies the signed-in user is authorized for — fetched
   * server-side from the database (see server/services/companies.ts), not
   * client-editable. This list is the actual authorization boundary for what
   * shows in the switcher; per-request server checks remain the boundary for
   * what data those selections can actually filter. */
  companies: string[];
  children: ReactNode;
}) {
  const [activeCompany, setActiveCompanyState] = useState<CompanyId>(ALL_COMPANIES);

  // Sync from localStorage after mount, same pattern as ThemeContext: avoids a
  // hydration mismatch since the server has no localStorage to read from.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && (stored === ALL_COMPANIES || companies.includes(stored))) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount sync from an external store (localStorage), not a reactive cascade
        setActiveCompanyState(stored);
      }
    } catch {
      // localStorage unavailable (e.g. privacy mode) — fall back to default
    }
  }, [companies]);

  function setActiveCompany(company: CompanyId) {
    setActiveCompanyState(company);
    try {
      localStorage.setItem(STORAGE_KEY, company);
    } catch {
      // ignore write failures
    }
  }

  return (
    <CompanyContext.Provider value={{ companies, activeCompany, setActiveCompany }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within a CompanyProvider");
  return ctx;
}
