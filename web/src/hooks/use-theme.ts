import { useCallback, useEffect } from "react";

import { useLocalValue } from "@/lib/local-store";

export type ThemeMode = "system" | "light" | "dark";

export function useTheme() {
  const [stored, store] = useLocalValue("flowmesh-theme");
  const mode: ThemeMode = stored === "light" || stored === "dark" ? stored : "system";
  const setMode = useCallback((m: ThemeMode) => store(m), [store]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle("dark", mode === "dark" || (mode === "system" && query.matches));
    apply();
    if (mode !== "system") return;
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [mode]);

  return { mode, setMode };
}
