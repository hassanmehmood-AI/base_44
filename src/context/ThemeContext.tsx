"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type ColorTheme = "blue" | "gray" | "orange";
export type DesignSystem = "bento" | "brutalist" | "aurora";

const COLOR_KEY = "crm-color-theme";
const DESIGN_KEY = "crm-design-system";

const DEFAULT_COLOR: ColorTheme = "blue";
const DEFAULT_DESIGN: DesignSystem = "bento";

interface ThemeContextValue {
  colorTheme: ColorTheme;
  designSystem: DesignSystem;
  setColorTheme: (theme: ColorTheme) => void;
  setDesignSystem: (design: DesignSystem) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(DEFAULT_COLOR);
  const [designSystem, setDesignSystemState] = useState<DesignSystem>(DEFAULT_DESIGN);

  // Sync from localStorage on mount. The blocking script in layout.tsx already
  // applied data-theme/data-design to <html> before paint (avoiding a flash of
  // the wrong theme); this only syncs React state so the switcher UI highlights
  // the correct option. It can't run during SSR or as a lazy useState initializer
  // without risking a hydration mismatch, since the server has no localStorage.
  useEffect(() => {
    try {
      const storedColor = localStorage.getItem(COLOR_KEY) as ColorTheme | null;
      const storedDesign = localStorage.getItem(DESIGN_KEY) as DesignSystem | null;
      if (storedColor === "blue" || storedColor === "gray" || storedColor === "orange") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount sync from an external store (localStorage), not a reactive cascade
        setColorThemeState(storedColor);
      }
      if (storedDesign === "bento" || storedDesign === "brutalist" || storedDesign === "aurora") {
        setDesignSystemState(storedDesign);
      }
    } catch {
      // localStorage unavailable (e.g. privacy mode) — fall back to defaults
    }
  }, []);

  function setColorTheme(theme: ColorTheme) {
    setColorThemeState(theme);
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(COLOR_KEY, theme);
    } catch {
      // ignore write failures
    }
  }

  function setDesignSystem(design: DesignSystem) {
    setDesignSystemState(design);
    document.documentElement.setAttribute("data-design", design);
    try {
      localStorage.setItem(DESIGN_KEY, design);
    } catch {
      // ignore write failures
    }
  }

  return (
    <ThemeContext.Provider value={{ colorTheme, designSystem, setColorTheme, setDesignSystem }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
