"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { useApp } from "@/components/app-provider";
import { PageContainer } from "@/components/shared/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewWorkflowDialog } from "@/components/workflows/new-workflow-dialog";
import { listWorkflows, patchWorkflow, qk } from "@/lib/api/endpoints";
import { canEdit } from "@/lib/api/types";

export function WorkflowsView() {
  const { currentWorkspace, role, workspaces } = useApp();
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const wsId = currentWorkspace?.id ?? "";
  const editor = canEdit(role);

  const query = useQuery({
    queryKey: qk.workflows(wsId, showArchived),
    queryFn: () => listWorkflows(wsId, showArchived),
    enabled: wsId !== "",
  });

  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => patchWorkflow(id, { is_active: active }),
    onSuccess: (wf) => {
      toast.success(wf.is_active ? `“${wf.name}” restored` : `“${wf.name}” archived`);
      return qc.invalidateQueries({ queryKey: qk.workflowsOf(wsId) });
    },
    onError: (err) => toast.error(err.message),
  });

  const newButton = (
    <Button onClick={() => setCreating(true)} disabled={!editor} title={editor ? undefined : "Editors and admins can create workflows"}>
      <Plus /> New workflow
    </Button>
  );

  return (
    <PageContainer
      title="Workflows"
      subtitle={currentWorkspace ? `In ${currentWorkspace.name}. You are ${role}.` : "Create a workspace to get started."}
      actions={currentWorkspace ? newButton : undefined}
      showNewWorkflow={false}
    >
      {workspaces !== undefined && !currentWorkspace && (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          You are not in a workspace yet. Use the workspace menu in the sidebar and choose “New workspace”.
        </p>
      )}

      {currentWorkspace && (
        <>
          <div className="mb-3 flex items-center justify-end">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
            </label>
          </div>

          {query.isPending && (
            <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
          )}

          {query.isError && (
            <div role="alert" className="rounded-md border border-destructive/40 p-4 text-sm">
              <p className="mb-2 text-destructive">{query.error.message}</p>
              <Button size="sm" variant="outline" onClick={() => query.refetch()}>Try again</Button>
            </div>
          )}

          {query.data && query.data.length === 0 && (
            <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No workflows yet.{editor ? " Create your first one with “New workflow”." : ""}
            </p>
          )}

          {query.data && query.data.length > 0 && (
            <div className="rounded-md border border-border bg-surface">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Live version</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="font-medium">
                        <Link href={`/workflows/${w.id}`} className="hover:underline">{w.name}</Link>
                      </TableCell>
                      <TableCell>
                        {w.is_active ? <span className="status-live">Active</span> : <Badge variant="secondary">Archived</Badge>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {w.production_version ? `v${w.production_version}` : <span className="text-muted-foreground">Not published</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(w.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost"><Link href={`/workflows/${w.id}`}>Open</Link></Button>
                        {editor && (
                          <Button
                            size="sm" variant="ghost" disabled={setActive.isPending}
                            onClick={() => setActive.mutate({ id: w.id, active: !w.is_active })}
                          >
                            {w.is_active ? "Archive" : "Restore"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <NewWorkflowDialog workspaceId={wsId} open={creating} onOpenChange={setCreating} />
        </>
      )}
    </PageContainer>
  );
}
