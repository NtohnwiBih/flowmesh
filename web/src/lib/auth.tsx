"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";

import { tokenStore } from "@/lib/api/client";
import { login as apiLogin, register as apiRegister } from "@/lib/api/endpoints";

export type AuthStatus = "loading" | "anon" | "authed";

type AuthValue = {
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // The server cannot see sessionStorage, so it (and the first client render)
  // reports `undefined` = "not known yet"; then the real token takes over.
  const token = useSyncExternalStore<string | null | undefined>(tokenStore.subscribe, tokenStore.get, () => undefined);
  const status: AuthStatus = token === undefined ? "loading" : token ? "authed" : "anon";

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await apiLogin(email, password);
      qc.clear(); // never show a previous user's cached data
      tokenStore.set(res.access_token);
    },
    [qc],
  );
  const register = useCallback(
    async (email: string, password: string) => {
      await apiRegister(email, password);
      await login(email, password);
    },
    [login],
  );
  const logout = useCallback(() => {
    tokenStore.clear();
    qc.clear();
  }, [qc]);

  const value = useMemo(() => ({ status, login, register, logout }), [status, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function FullPageSpinner() {
  return (
    <div className="grid h-screen place-items-center bg-background text-muted-foreground">
      <LoaderCircle className="size-5 animate-spin" aria-label="Loading" />
    </div>
  );
}

/** Wrap the signed-in part of the app. Anonymous visitors are sent to /login. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === "anon") router.replace("/login");
  }, [status, router]);
  if (status !== "authed") return <FullPageSpinner />;
  return <>{children}</>;
}
