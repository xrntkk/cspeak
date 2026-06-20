import { useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "csspeak.themeMode";

function readMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // ignore
  }
  return "system";
}

function writeMode(mode: ThemeMode) {
  localStorage.setItem(THEME_KEY, mode);
}

function resolve(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode) {
  const resolved = resolve(mode);
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => readMode());
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(mode));

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    writeMode(next);
    applyTheme(next);
    setResolved(resolve(next));
  };

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (mode === "system") {
        applyTheme("system");
        setResolved(resolve("system"));
      }
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [mode]);

  const cycle = () => {
    const order: ThemeMode[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(mode) + 1) % order.length];
    setMode(next);
  };

  return { mode, resolved, setMode, cycle };
}

export function getInitialThemeMode(): ThemeMode {
  return readMode();
}
