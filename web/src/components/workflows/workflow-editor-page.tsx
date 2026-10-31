"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useApp } from "@/components/app-provider";
import { WorkflowEditor } from "@/components/editor/editor";
import type { DraftMeta } from "@/components/editor/use-draft-actions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { getDraft, getNodeTypes, getVersion, getWorkflow, qk } from "@/lib/api/endpoints";
import { canEdit, type Draft } from "@/lib/api/types";
import { toFlow, type Definition } from "@/lib/definition";
import { cn } from "@/lib/utils";

const metaOf = (d: Draft): DraftMeta => ({
  etag: d.etag, revision: d.revision, base_version: d.base_version, production_version: d.production_version,
  has_unpublished_changes: d.has_unpublished_changes, staging_verified: d.staging_verified,
});

/** Drafts are saved leniently, so check the canvas can actually draw one before mounting the editor. */
function drawable(def: Definition): boolean {
  try { toFlow(def); return true; } catch { return false; }
}

/** Loads a workflow, its draft and the node catalog, and mounts the editor.
 *  The sidebar's environment switch picks the copy: Staging = the editable draft,
 *  Production = the live version, read-only. */
export function WorkflowEditorPage({ id }: { id: string }) {
  const { workspaces, envKey, setEnvironment } = useApp();
  const [epoch, setEpoch] = useState(0); // bumping it remounts the staging editor from fresh data
  const [published, setPublished] = useState<number | null>(null); // set when this page publishes

  // The editor copies the draft into its own state on mount, so always read it fresh.
  const fresh = { staleTime: 0, gcTime: 0, refetchOnMount: "always" as const };
  const types = useQuery({ queryKey: qk.nodeTypes, queryFn: getNodeTypes, staleTime: 5 * 60_000 });
  const workflow = useQuery({ queryKey: qk.workflow(id), queryFn: () => getWorkflow(id), ...fresh });
  const draft = useQuery({ queryKey: qk.draft(id), queryFn: () => getDraft(id), ...fresh });

  const liveVersion = published ?? workflow.data?.production_version ?? null;
  const live = useQuery({
    queryKey: qk.version(id, liveVersion ?? 0),
    queryFn: () => getVersion(id, liveVersion!),
    enabled: envKey === "production" && liveVersion !== null,
    staleTime: Infinity, // a published version never changes
  });

  const role = useMemo(
    () => workspaces?.find((w) => w.id === workflow.data?.workspace_id)?.role ?? null,
    [workspaces, workflow.data?.workspace_id],
  );

  const error = workflow.error ?? draft.error ?? types.error ?? live.error;
  if (error) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div role="alert" className="grid h-full place-items-center p-8 text-center">
        <div>
          <p className="mb-1 font-medium">{missing ? "Workflow not found" : "Could not load this workflow"}</p>
          <p className="mb-4 text-sm text-muted-foreground">
            {missing ? "It may have been deleted, or you may not have access to it." : error.message}
          </p>
          {!missing && <Button variant="outline" onClick={() => { void workflow.refetch(); void draft.refetch(); void types.refetch(); }}>Try again</Button>}
        </div>
      </div>
    );
  }

  if (!workflow.data || !draft.data || !types.data || workspaces === undefined) {
    return <div className="grid gap-3 p-6"><Skeleton className="h-14 w-full" /><Skeleton className="h-[60vh] w-full" /></div>;
  }

  if (!drawable(draft.data.definition)) {
    return (
      <div role="alert" className="grid h-full place-items-center p-8 text-center">
        <p className="text-sm text-muted-foreground">This draft has an unexpected shape and cannot be opened in the editor.</p>
      </div>
    );
  }

  const editable = canEdit(role);
  const wf = { id, name: workflow.data.name, is_active: workflow.data.is_active };
  const switchView = (to: "staging" | "production") => setEnvironment(to === "staging" ? "Staging" : "Production");
  const reload = async () => { await draft.refetch(); setEpoch((e) => e + 1); };
  const showingProduction = envKey === "production";

  return (
    <div className="h-full min-h-0">
      {/* Stays mounted while you look at production, so unsaved edits survive the switch. */}
      <div className={cn("h-full min-h-0", showingProduction && "hidden")}>
        <WorkflowEditor
          key={`${id}:${epoch}`} workflow={wf} definition={draft.data.definition} view="staging" canEdit={editable}
          draft={metaOf(draft.data)} nodeTypes={types.data} onSwitchView={switchView} onReload={reload} onPublished={setPublished}
        />
      </div>

      {showingProduction && (
        liveVersion === null ? (
          <div className="grid h-full place-items-center p-8 text-center">
            <div>
              <p className="mb-1 font-medium">Not published yet</p>
              <p className="mb-4 text-sm text-muted-foreground">Nothing is live in production. Build it in staging, then publish.</p>
              <Button onClick={() => switchView("staging")}>Open the staging draft</Button>
            </div>
          </div>
        ) : live.data ? (
          <WorkflowEditor
            key={`prod:${live.data.version}`} workflow={wf} definition={live.data.definition} view="production" canEdit={editable}
            draft={{ ...metaOf(draft.data), production_version: live.data.version }} nodeTypes={types.data}
            onSwitchView={switchView} onReload={reload}
          />
        ) : (
          <div className="grid gap-3 p-6"><Skeleton className="h-14 w-full" /><Skeleton className="h-[60vh] w-full" /></div>
        )
      )}
    </div>
  );
}
