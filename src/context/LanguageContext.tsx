"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type Language = "en" | "es";

const LANGUAGE_KEY = "crm-language";
const DEFAULT_LANGUAGE: Language = "en";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (en: string, es: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => {},
  t: (en) => en,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  // Sync from localStorage on mount — same pattern as ThemeContext. Can't run
  // during SSR or as a lazy useState initializer without risking a hydration
  // mismatch, since the server has no localStorage; the brief flash back to
  // the stored language right after mount is the accepted tradeoff here too.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LANGUAGE_KEY) as Language | null;
      if (stored === "en" || stored === "es") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount sync from an external store (localStorage), not a reactive cascade
        setLanguageState(stored);
      }
    } catch {
      // localStorage unavailable (e.g. privacy mode) — fall back to default
    }
  }, []);

  function setLanguage(lang: Language) {
    setLanguageState(lang);
    try {
      localStorage.setItem(LANGUAGE_KEY, lang);
    } catch {
      // ignore write failures
    }
  }

  const t = (en: string, es: string) => (language === "es" ? es : en);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
