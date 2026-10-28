"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, GitBranch, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getRoute, nav } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app-provider";
import { CreateWorkspaceDialog } from "@/components/workspaces/create-workspace-dialog";
import { useAuth } from "@/lib/auth";

type SidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
};

export function Sidebar({ collapsed, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const route = getRoute(pathname);
  const router = useRouter();
  const { logout } = useAuth();
  const { workspace, workspaces, currentWorkspace, setWorkspaceId, environment, setEnvironment, profile, setAccountView } = useApp();
  const [creating, setCreating] = useState(false);

  const profileInitials = profile.name
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <>
      <aside
        className={cn(
          "app-sidebar",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          collapsed && "app-sidebar-collapsed",
        )}
      >
        {/* Brand */}
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <div className="brand-mark shrink-0"><GitBranch /></div>
          <span className={cn("font-display text-sm font-semibold", collapsed && "lg:hidden")}>FlowMesh</span>
          <span className={cn("ml-1 rounded border border-sidebar-border px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground", collapsed && "lg:hidden")}>CLOUD</span>
          <Button variant="ghost" size="icon" className="ml-auto lg:hidden" onClick={onMobileClose}><X /></Button>
        </div>

        {/* Workspace switcher */}
        <div className="border-b border-sidebar-border p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                type="button"
                className={cn("workspace-switcher h-auto w-full", collapsed && "lg:justify-center lg:px-0")}
                title={`${workspace} · ${environment}`}
                aria-label="Switch workspace or environment"
              >
                <div className="grid size-6 shrink-0 place-items-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
                  {workspace.charAt(0).toUpperCase()}
                </div>
                <div className={cn("min-w-0 flex-1 text-left", collapsed && "lg:hidden")}>
                  <p className="truncate text-xs font-medium">{workspace}</p>
                  <p className="text-[10px] text-muted-foreground">{environment}</p>
                </div>
                <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground", collapsed && "lg:hidden")} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
                {workspaces === undefined && <DropdownMenuItem disabled>Loading…</DropdownMenuItem>}
                {workspaces?.map((w) => (
                  <DropdownMenuItem key={w.id} onClick={() => { setWorkspaceId(w.id); router.push("/workflows"); }}>
                    <div className="grid size-5 place-items-center rounded bg-primary text-[9px] font-bold text-primary-foreground">{w.name.charAt(0).toUpperCase()}</div>
                    <span className="min-w-0 flex-1 truncate">{w.name}</span>
                    {w.id === currentWorkspace?.id && <Check className="size-3.5" />}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={() => setCreating(true)}><Plus className="size-4" /> New workspace</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Environment</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => { setEnvironment("Production"); toast.success("Environment set to Production"); }}>Production</DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setEnvironment("Staging"); toast.success("Environment set to Staging"); }}>Staging</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2">
          <p className={cn("px-2 pb-2 pt-1 text-[9px] font-semibold uppercase text-muted-foreground", collapsed && "lg:hidden")}>Workspace</p>
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              onClick={onMobileClose}
              className={cn("nav-item", route?.href === item.href && "nav-item-active", collapsed && "lg:relative lg:justify-center lg:px-0")}
            >
              <item.icon />
              <span className={cn("truncate", collapsed && "lg:hidden")}>{item.label}</span>
              {item.label === "Workers" && (
                <span className={cn("ml-auto size-1.5 rounded-full bg-success", collapsed && "lg:absolute lg:right-2 lg:top-2 lg:ml-0")} />
              )}
            </Link>
          ))}
        </nav>

        {/* Usage + account */}
        <div className="border-t border-sidebar-border p-3">
          <div className={cn("mb-3 rounded-md border border-sidebar-border bg-sidebar-accent/50 p-3", collapsed && "lg:hidden")}>
            <div className="mb-2 flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">Monthly executions</span>
              <span className="font-mono">68%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full w-[68%] bg-primary" /></div>
            <p className="mt-2 font-mono text-[9px] text-muted-foreground">68,204 / 100,000</p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                type="button"
                className={cn("h-auto w-full justify-start gap-2 rounded-md p-2 text-left hover:bg-sidebar-accent", collapsed && "lg:justify-center lg:p-2 lg:px-0")}
                title={profile.name}
                aria-label="Account menu"
              >
                <div className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-semibold">{profileInitials}</div>
                <div className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
                  <p className="truncate text-xs font-medium">{profile.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{profile.email}</p>
                </div>
                <ChevronDown className={cn("size-3 shrink-0", collapsed && "lg:hidden")} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <p className="truncate text-xs font-medium">{profile.name}</p>
                  <p className="truncate text-[10px] font-normal text-muted-foreground">{profile.email}</p>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setAccountView("profile")}>Profile</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAccountView("preferences")}>Preferences</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAccountView("keys")}>API keys</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { logout(); router.replace("/login"); }}>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />

      {mobileOpen && (
        <button className="fixed inset-0 z-30 bg-overlay lg:hidden" onClick={onMobileClose} aria-label="Close navigation" />
      )}
    </>
  );
}