import { useState, useEffect, useCallback } from "react";

export type Theme = "light" | "dark" | "system";

function getSystemIsDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const isDark = theme === "dark" || (theme === "system" && getSystemIsDark());
  root.classList.toggle("dark", isDark);
  root.classList.toggle("light", !isDark);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    return stored ?? "system";
  });

  // Re-apply when system preference changes (only matters when theme === "system")
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem("theme", t);
    setThemeState(t);
    applyTheme(t);
  }, []);

  return { theme, setTheme };
}
