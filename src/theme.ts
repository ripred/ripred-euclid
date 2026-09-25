import type { ThemePreference } from "./settings";

/**
 * Light and dark chrome. "system" follows the device's appearance setting and
 * updates live when it changes; the board itself looks the same in both.
 */

export type ThemeMode = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemTheme(): ThemeMode {
  try {
    return window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

export const resolveTheme = (preference: ThemePreference): ThemeMode =>
  preference === "system" ? systemTheme() : preference;

export function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  // Browser chrome (address bar, installed-app title bar) matches the page.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#111112" : "#efefec");
}

/** Keeps the document on the preferred theme; returns a cleanup function. */
export function followTheme(preference: ThemePreference): () => void {
  applyTheme(resolveTheme(preference));
  if (preference !== "system" || !window.matchMedia) return () => undefined;
  const media = window.matchMedia(DARK_QUERY);
  const onChange = () => applyTheme(systemTheme());
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
