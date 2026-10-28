"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import type { AccountView, Profile } from "@/components/account-views";
import { useTheme, type ThemeMode } from "@/hooks/use-theme";
import { fetchMe, listWorkspaces, qk } from "@/lib/api/endpoints";
import type { EnvKey, Me, Role, Workspace } from "@/lib/api/types";
import { useLocalValue } from "@/lib/local-store";

type EnvName = "Production" | "Staging";

type AppContextValue = {
  // ---- real data -------------------------------------------------------------
  me: Me | undefined;
  workspaces: Workspace[] | undefined; // undefined while loading
  currentWorkspace: Workspace | null;
  setWorkspaceId: (id: string) => void;
  role: Role | null; // the caller's role in the current workspace
  environment: EnvName;
  envKey: EnvKey; // the same choice, as the API spells it
  setEnvironment: (v: EnvName) => void;
  // ---- kept for existing components -----------------------------------------------
  workspace: string; // current workspace name
  pendingIntegration: string | null;
  setPendingIntegration: (v: string | null) => void;
  accountView: AccountView | null;
  setAccountView: (v: AccountView | null) => void;
  profile: Profile;
  setProfile: (p: Profile) => void;
  theme: ThemeMode;
  setTheme: (m: ThemeMode) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const meQuery = useQuery({ queryKey: qk.me, queryFn: fetchMe });
  const workspacesQuery = useQuery({ queryKey: qk.workspaces, queryFn: listWorkspaces });

  const [savedWorkspaceId, setWorkspaceId] = useLocalValue("fm_workspace");
  const [savedEnv, setSavedEnv] = useLocalValue("fm_env");
  const environment: EnvName = savedEnv === "Staging" ? "Staging" : "Production";

  const workspaces = workspacesQuery.data;
  // The saved choice if it still exists, otherwise the first workspace.
  const currentWorkspace = workspaces?.find((w) => w.id === savedWorkspaceId) ?? workspaces?.[0] ?? null;

  const [pendingIntegration, setPendingIntegration] = useState<string | null>(null);
  const [accountView, setAccountView] = useState<AccountView | null>(null);
  const [profileEdits, setProfileEdits] = useState<Partial<Profile>>({}); // the profile form is not saved server-side yet
  const { mode: theme, setMode: setTheme } = useTheme(); // once here, so every consumer shares it

  const email = meQuery.data?.email ?? "";
  const profile: Profile = {
    name: email ? email.split("@")[0] : "…",
    email,
    role: currentWorkspace?.role ?? "",
    ...profileEdits,
  };

  const value: AppContextValue = useMemo(
    () => ({
      me: meQuery.data,
      workspaces,
      currentWorkspace,
      setWorkspaceId,
      role: currentWorkspace?.role ?? null,
      environment,
      envKey: environment === "Staging" ? "staging" : "production",
      setEnvironment: setSavedEnv,
      workspace: currentWorkspace?.name ?? "No workspace",
      pendingIntegration, setPendingIntegration,
      accountView, setAccountView,
      profile, setProfile: (p: Profile) => setProfileEdits(p),
      theme, setTheme,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- profile is derived from the values listed
    [meQuery.data, workspaces, currentWorkspace, setWorkspaceId, environment, setSavedEnv,
      pendingIntegration, accountView, profileEdits, theme, setTheme],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
