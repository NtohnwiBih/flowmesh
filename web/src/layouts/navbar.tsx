"use client";

import { usePathname } from "next/navigation";
import { Bell, CircleHelp, Menu, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ThemeMode } from "@/hooks/use-theme";
import { getRoute } from "@/lib/nav";
import { useApp } from "@/components/app-provider";

const themeModes: { value: ThemeMode; label: string; hint: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", hint: "Match device", icon: Monitor },
  { value: "light", label: "Light", hint: "Bright", icon: Sun },
  { value: "dark", label: "Dark", hint: "Low light", icon: Moon },
];

function ThemeToggle() {
  const { theme, setTheme } = useApp();
  const active = themeModes.find((m) => m.value === theme) ?? themeModes[0];
  const ActiveIcon = active.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title="Theme" aria-label={`Theme: ${active.label}`}>
          <ActiveIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (value === "system" || value === "light" || value === "dark") setTheme(value);
          }}
        >
          {themeModes.map((m) => (
            <DropdownMenuRadioItem key={m.value} value={m.value}>
              <span className="flex items-center gap-2">
                <m.icon className="size-3.5" />
                {m.label}
              </span>
              <DropdownMenuShortcut className="ml-auto font-mono text-[9px]">{m.hint}</DropdownMenuShortcut>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type NavbarProps = {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenMobile: () => void;
};

export function Navbar({ collapsed, onToggleCollapse, onOpenMobile }: NavbarProps) {
  const pathname = usePathname();
  const route = getRoute(pathname);
  const { workspace, environment } = useApp();
  const title = /^\/workflows\/[^/]+/.test(pathname) ? "Workflow Editor" : route?.label ?? "FlowMesh";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-3 sm:px-5">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="hidden lg:inline-flex"
          title={collapsed ? "Open sidebar" : "Close sidebar"}
          aria-label={collapsed ? "Open sidebar" : "Close sidebar"}
          aria-expanded={!collapsed}
          onClick={onToggleCollapse}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={onOpenMobile}>
          <Menu />
        </Button>
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="hidden text-[10px] text-muted-foreground sm:block">{workspace} / {environment}</p>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" className="hidden w-56 justify-start text-muted-foreground md:flex">
          <Search /> Search anything <span className="ml-auto font-mono text-[9px]">⌘ K</span>
        </Button>
        <ThemeToggle />
        <Button variant="ghost" size="icon" title="Help"><CircleHelp /></Button>
        <Button variant="ghost" size="icon" title="Notifications" className="relative">
          <Bell />
          <span className="absolute right-2 top-2 size-1.5 rounded-full bg-warning" />
        </Button>
      </div>
    </header>
  );
}