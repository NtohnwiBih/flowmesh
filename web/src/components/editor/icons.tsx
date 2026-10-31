import { Clock3, Code2, GitBranch, Globe2, Sparkles, Webhook, Workflow, Zap, type LucideIcon } from "lucide-react";

// Icon names come from the API's node catalog (and from fallback data in lib/definition.ts).
const ICONS: Record<string, LucideIcon> = {
  webhook: Webhook,
  clock: Clock3,
  http: Globe2,
  condition: GitBranch,
  code: Code2,
  ai: Sparkles,
  action: Zap,
};

/** Renders the icon for a catalog name. Looking it up inside this component (instead of
 *  choosing a component in the caller's render) keeps React from treating it as a new
 *  component on every render, which would reset its state. */
export function NodeIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Workflow;
  return <Icon className={className} aria-hidden="true" />;
}
