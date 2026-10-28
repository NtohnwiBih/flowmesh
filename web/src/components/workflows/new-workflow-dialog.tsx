"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWorkflow, qk } from "@/lib/api/endpoints";

export function NewWorkflowDialog({
  workspaceId, open, onOpenChange,
}: { workspaceId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workflow</DialogTitle>
          <DialogDescription>It starts as an empty draft in staging. Nothing is live until you publish.</DialogDescription>
        </DialogHeader>
        <Form workspaceId={workspaceId} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function Form({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => createWorkflow(workspaceId, name.trim()),
    onSuccess: async (wf) => {
      await qc.invalidateQueries({ queryKey: qk.workflowsOf(workspaceId) });
      onDone();
      router.push(`/workflows/${wf.id}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate();
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="wf-name">Name</Label>
        <Input id="wf-name" autoFocus maxLength={255} value={name} onChange={(e) => setName(e.target.value)} placeholder="Support intake routing" />
      </div>
      {create.error && <p role="alert" className="text-sm text-destructive">{create.error.message}</p>}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          {create.isPending && <LoaderCircle className="animate-spin" />} Create workflow
        </Button>
      </DialogFooter>
    </form>
  );
}
