"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useApp } from "@/components/app-provider";
import { WorkflowEditor } from "@/components/workflow-editor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { getDraft, getWorkflow, qk } from "@/lib/api/endpoints";
import { toFlow } from "@/lib/definition";

/** Loads a workflow's draft and hands it to the editor. */
export function WorkflowEditorPage({ id }: { id: string }) {
  const { environment, pendingIntegration, setPendingIntegration } = useApp();
  // Always fetch fresh: the editor copies the draft into its own state once, on mount.
  const fresh = { staleTime: 0, gcTime: 0, refetchOnMount: "always" as const };
  const workflow = useQuery({ queryKey: qk.workflow(id), queryFn: () => getWorkflow(id), ...fresh });
  const draft = useQuery({ queryKey: qk.draft(id), queryFn: () => getDraft(id), ...fresh });

  const converted = useMemo(() => {
    if (!draft.data) return null;
    try {
      return { ok: true as const, flow: toFlow(draft.data.definition) };
    } catch {
      return { ok: false as const };
    }
  }, [draft.data]);

  const error = workflow.error ?? draft.error;
  if (error) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div role="alert" className="grid h-full place-items-center p-8 text-center">
        <div>
          <p className="mb-1 font-medium">{missing ? "Workflow not found" : "Could not load this workflow"}</p>
          <p className="mb-4 text-sm text-muted-foreground">
            {missing ? "It may have been deleted, or you may not have access to it." : error.message}
          </p>
          {!missing && <Button variant="outline" onClick={() => { workflow.refetch(); draft.refetch(); }}>Try again</Button>}
        </div>
      </div>
    );
  }

  if (!workflow.data || !draft.data || !converted) {
    return <div className="grid gap-3 p-6"><Skeleton className="h-14 w-full" /><Skeleton className="h-[60vh] w-full" /></div>;
  }

  if (!converted.ok) {
    return (
      <div role="alert" className="grid h-full place-items-center p-8 text-center">
        <p className="text-sm text-muted-foreground">This draft has an unexpected shape and cannot be opened in the editor.</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0">
      <WorkflowEditor
        key={`${id}:${draft.data.revision}`}
        environment={environment}
        loaded={converted.flow}
        title={workflow.data.name}
        versionLabel={draft.data.production_version ? `v${draft.data.production_version}` : "Not published"}
        pendingIntegration={pendingIntegration}
        onPendingHandled={() => setPendingIntegration(null)}
      />
    </div>
  );
}
