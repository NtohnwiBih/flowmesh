"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LoaderCircle } from "lucide-react";

import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWorkspace, qk } from "@/lib/api/endpoints";
import { slugifyWorkspace, WORKSPACE_SLUG } from "@/lib/slug";

export function CreateWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>A workspace holds your workflows and your team. You become its admin.</DialogDescription>
        </DialogHeader>
        {/* a separate component, so its fields reset every time the dialog opens */}
        <CreateForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const { setWorkspaceId } = useApp();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const shownSlug = slugEdited ? slug : name ? slugifyWorkspace(name) : "";
  const valid = name.trim().length > 0 && WORKSPACE_SLUG.test(shownSlug);

  const create = useMutation({
    mutationFn: () => createWorkspace(name.trim(), shownSlug),
    onSuccess: async (ws) => {
      await qc.invalidateQueries({ queryKey: qk.workspaces });
      setWorkspaceId(ws.id);
      toast.success(`Workspace “${ws.name}” created`);
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (valid) create.mutate();
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="ws-name">Name</Label>
        <Input id="ws-name" autoFocus maxLength={255} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Engineering" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ws-slug">URL name</Label>
        <Input
          id="ws-slug" value={shownSlug} maxLength={63} className="font-mono"
          onChange={(e) => { setSlug(e.target.value.toLowerCase()); setSlugEdited(true); }}
        />
        {shownSlug !== "" && !WORKSPACE_SLUG.test(shownSlug) && (
          <p className="text-xs text-destructive">Use lowercase letters, numbers and dashes, starting with a letter or number.</p>
        )}
      </div>
      {create.error && <p role="alert" className="text-sm text-destructive">{create.error.message}</p>}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={!valid || create.isPending}>
          {create.isPending && <LoaderCircle className="animate-spin" />} Create workspace
        </Button>
      </DialogFooter>
    </form>
  );
}
