"use client";

import { LoaderCircle, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { describeProblems } from "@/lib/issues";

export function PublishDialog({
  open, onOpenChange, nextVersion, stagingVerified, hasUnsavedChanges, knownProblems, busy, onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nextVersion: number;
  stagingVerified: boolean;
  hasUnsavedChanges: boolean;
  knownProblems: number;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish version {nextVersion}?</DialogTitle>
          <DialogDescription>
            This creates an immutable version and makes it live in production. Webhooks and runs in production use it immediately. You can roll back later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          {hasUnsavedChanges && <Note>Your unsaved changes will be saved first.</Note>}
          {!stagingVerified && (
            <Note warn title="Not verified in staging">
              This exact draft has no successful staging run. You can still publish.
            </Note>
          )}
          {knownProblems > 0 && (
            <Note warn title={describeProblems(knownProblems)}>
              Publishing is refused while a step has problems. Fix them, or publish and see what the API reports.
            </Note>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy} onClick={onConfirm}>
            {busy && <LoaderCircle className="animate-spin" />} Publish v{nextVersion}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConflictDialog({
  open, busy, onReload, onOverwrite, onCancel,
}: { open: boolean; busy: boolean; onReload: () => void; onOverwrite: () => void; onCancel: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>This draft was changed elsewhere</DialogTitle>
          <DialogDescription>
            Someone else (or another tab of yours) saved the draft after you opened it. Saving now would silently replace their work, so nothing was saved.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li><strong className="text-foreground">Load latest</strong> discards your unsaved edits and shows their version.</li>
          <li><strong className="text-foreground">Keep mine</strong> saves your version over theirs.</li>
        </ul>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>Keep editing</Button>
          <Button variant="outline" disabled={busy} onClick={onOverwrite}>
            {busy && <LoaderCircle className="animate-spin" />} Keep mine
          </Button>
          <Button disabled={busy} onClick={onReload}>Load latest</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Note({ children, title, warn = false }: { children: React.ReactNode; title?: string; warn?: boolean }) {
  return (
    <div className={`rounded-md border p-3 text-xs ${warn ? "border-warning/40 bg-warning/5" : "border-border bg-muted/40"}`}>
      {title && <p className="mb-0.5 flex items-center gap-1.5 font-semibold"><TriangleAlert className="size-3.5 text-warning" />{title}</p>}
      {children}
    </div>
  );
}
