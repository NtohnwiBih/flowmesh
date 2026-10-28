"use client";

import { useState, type ReactNode } from "react";

import { AccountViews } from "@/components/account-views";
import { Toaster } from "@/components/ui/sonner";
import { Sidebar } from "./sidebar";
import { Navbar } from "./navbar";
import { useApp } from "@/components/app-provider";

export function AppLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { accountView, setAccountView, profile, setProfile, theme, setTheme, workspace } = useApp();

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground">
      <Toaster position="bottom-right" />
      <AccountViews
        view={accountView}
        onViewChange={setAccountView}
        profile={profile}
        onSaveProfile={setProfile}
        theme={theme}
        onThemeChange={setTheme}
        workspace={workspace}
      />
      <div className="flex h-full">
        <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
        <main className="flex min-w-0 flex-1 flex-col">
          <Navbar
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((c) => !c)}
            onOpenMobile={() => setMobileOpen(true)}
          />
          <div className="min-h-0 flex-1">{children}</div>
        </main>
      </div>
    </div>
  );
}