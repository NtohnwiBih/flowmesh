"use client";

import { ChevronDown, LoaderCircle, Play, Radio, Save, ShieldCheck, TriangleAlert, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Issue } from "@/lib/api/types";
import { describeProblems } from "@/lib/issues";
import { cn } from "@/lib/utils";

export type SaveState = "readonly" | "saving" | "dirty" | "saved";

const SAVE_TEXT: Record<SaveState, string> = {
  readonly: "Read-only",
  saving: "Saving…",
  dirty: "Unsaved changes",
  saved: "All changes saved",
};

export function EditorToolbar({
  title, isActive, subtitle, saveState, readOnly, canSave, canPublish, validating, publishing, dryRunning,
  problems, labelOf, onValidate, onSave, onPublish, onDryRun, onFocusNode,
}: {
  title: string;
  isActive: boolean;
  subtitle: string; // for example "Staging draft · v3 live"
  saveState: SaveState;
  readOnly: boolean;
  canSave: boolean;
  canPublish: boolean;
  validating: boolean;
  publishing: boolean;
  dryRunning: boolean;
  problems: Issue[];
  labelOf: (nodeId: string) => string;
  onValidate: () => void;
  onSave: () => void;
  onPublish: () => void;
  onDryRun: (simulateFailure: boolean) => void;
  onFocusNode: (nodeId: string) => void;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Workflow className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            {isActive ? <span className="status-live">Active</span> : <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">Archived</span>}
          </div>
          <p className="truncate text-[11px] text-muted-foreground" role="status" aria-live="polite">
            {subtitle} · <span className={cn(saveState === "dirty" && "text-warning")}>{SAVE_TEXT[saveState]}</span>
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {problems.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:text-destructive">
                <TriangleAlert /> {describeProblems(problems.length)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-80 overflow-y-auto">
              {problems.map((p, i) => (
                <DropdownMenuItem key={i} disabled={!p.node_id} onClick={() => p.node_id && onFocusNode(p.node_id)} className="flex-col items-start gap-0.5">
                  <span className="text-xs font-medium">{p.node_id ? labelOf(p.node_id) : "Workflow"}</span>
                  <span className="text-[11px] text-muted-foreground">{p.message}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button variant="ghost" size="sm" disabled={readOnly || validating} onClick={onValidate} title="Check this draft for problems">
          {validating ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />} <span className="hidden sm:inline">Validate</span>
        </Button>
        <Button variant="outline" size="sm" disabled={!canSave} onClick={onSave} title="Save the draft (Ctrl or Cmd + S)">
          {saveState === "saving" ? <LoaderCircle className="animate-spin" /> : <Save />} <span className="hidden sm:inline">Save</span>
        </Button>
        <Button variant="outline" size="sm" disabled={!canPublish} onClick={onPublish} title="Make this draft the live version">
          {publishing ? <LoaderCircle className="animate-spin" /> : <Radio />} <span className="hidden lg:inline">Publish</span>
        </Button>

        <div className="flex items-center gap-0.5">
          <Button size="sm" disabled={dryRunning} onClick={() => onDryRun(false)} title="Preview how a run would flow. Nothing is executed.">
            {dryRunning ? <LoaderCircle className="animate-spin" /> : <Play className="fill-current" />} {dryRunning ? "Running" : "Dry run"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" className="size-8" disabled={dryRunning} aria-label="Dry run options" title="Dry run options"><ChevronDown /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onDryRun(false)}>Preview a successful run</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDryRun(true)}>Preview a failed run</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
