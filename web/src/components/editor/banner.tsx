"use client";

import { Eye, GitCommitHorizontal, LockKeyhole, PencilLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type View = "staging" | "production";

/** A strip under the toolbar that says which copy of the workflow this is, and what you can do with it. */
export function EnvironmentBanner({
  view, canEdit, productionVersion, hasUnpublished, onSwitch,
}: {
  view: View;
  canEdit: boolean;
  productionVersion: number | null;
  hasUnpublished: boolean;
  onSwitch: (to: View) => void;
}) {
  const live = productionVersion ? `v${productionVersion} is live` : "Nothing is live yet";

  let tone = "border-warning/30 bg-warning/10 text-warning";
  let icon = <PencilLine className="size-3.5" />;
  let text: string;
  let action: { label: string; to: View } | null = { label: "View production", to: "production" };

  if (view === "production") {
    tone = "border-success/30 bg-success/10 text-success";
    icon = <LockKeyhole className="size-3.5" />;
    text = `Production · ${live}. This view is read-only.`;
    action = { label: canEdit ? "Edit in staging" : "View the draft", to: "staging" };
  } else if (!canEdit) {
    tone = "border-border bg-muted text-muted-foreground";
    icon = <Eye className="size-3.5" />;
    text = "Staging draft · view only. Your role cannot edit this workflow.";
  } else {
    icon = <GitCommitHorizontal className="size-3.5" />;
    text = `Staging draft · ${live} · ${hasUnpublished ? "unpublished changes" : "matches production"}`;
  }

  return (
    <div role="status" className={cn("flex h-9 shrink-0 items-center justify-between gap-3 border-b px-4 text-xs", tone)}>
      <span className="flex min-w-0 items-center gap-2 truncate font-medium">{icon}{text}</span>
      {action && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onSwitch(action.to)}>{action.label}</Button>}
    </div>
  );
}
