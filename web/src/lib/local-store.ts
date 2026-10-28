"use client";

import { useCallback, useSyncExternalStore } from "react";

// A tiny persisted value. useSyncExternalStore gives the server and the first
// client render the same value (null), then switches to what localStorage holds,
// so there is no hydration mismatch and no setState-inside-an-effect.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb); // other tabs
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useLocalValue(key: string): readonly [string | null, (v: string | null) => void] {
  const value = useSyncExternalStore(subscribe, () => read(key), () => null);
  const set = useCallback(
    (v: string | null) => {
      try {
        if (v === null) localStorage.removeItem(key);
        else localStorage.setItem(key, v);
      } catch {
        /* storage unavailable: the value just will not persist */
      }
      notify();
    },
    [key],
  );
  return [value, set] as const;
}
