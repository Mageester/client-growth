import { createContext, useContext } from "react";

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "client-growth-theme";

/**
 * The appearance control lives in two places at once — the workspace menu and
 * the small control beside the page date — so the choice is held once, here,
 * rather than duplicated. The default is inert so a component rendered outside
 * the signed-in frame (the design harness, a public page) still renders.
 */
export const ThemeContext = createContext<{
  theme: ThemePreference;
  chooseTheme: (theme: ThemePreference) => void;
}>({ theme: "dark", chooseTheme: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

export function readStoredTheme(): ThemePreference {
  let stored: string | null = null;
  try {
    stored = window.localStorage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    // Privacy-focused browser modes may disable storage entirely.
  }
  if (!stored) {
    stored =
      document.cookie
        .split("; ")
        .find((part) => part.startsWith(THEME_STORAGE_KEY + "="))
        ?.split("=")[1] ?? null;
  }
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
}
