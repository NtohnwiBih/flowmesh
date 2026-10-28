import {
  Activity,
  BarChart3,
  Blocks,
  Cpu,
  FileStack,
  LayoutDashboard,
  Settings,
  Workflow,
} from "lucide-react";

export const nav = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Workflows", href: "/workflows", icon: Workflow },
  { label: "Execution Details", href: "/executions", icon: Activity },
  { label: "Templates", href: "/templates", icon: FileStack },
  { label: "Integrations", href: "/integrations", icon: Blocks },
  { label: "Workers", href: "/workers", icon: Cpu },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

export function getRoute(pathname: string) {
  return nav.find((item) => pathname === item.href || pathname.startsWith(item.href + "/"));
}