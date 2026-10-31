"use client";

import { useMemo } from "react";
import { Copy, Trash2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Issue, NodeType } from "@/lib/api/types";
import type { NodeData } from "@/lib/definition";
import { nodeLevel } from "@/lib/issues";
import { fieldsFromSchema, type Config } from "@/lib/schema-form";
import { SchemaForm } from "./schema-form";

type Retry = NonNullable<NodeData["retry"]>;
const DEFAULT_RETRY: Retry = { max_attempts: 3, backoff_seconds: 5 };

export type Upstream = { id: string; label: string };

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success("Copied", { description: text }),
    () => toast.error("Could not copy"),
  );
}

export function ConfigPanel({
  id, data, nodeType, issues, upstream, readOnly,
  onClose, onRename, onConfig, onRetry, onDelete,
}: {
  id: string;
  data: NodeData;
  nodeType: NodeType | undefined; // undefined: the API does not know this type
  issues: Issue[];
  upstream: Upstream[]; // steps whose output reaches this one, nearest first
  readOnly: boolean;
  onClose: () => void;
  onRename: (name: string) => void;
  onConfig: (config: Config | undefined) => void;
  onRetry: (retry: Retry | undefined) => void;
  onDelete: () => void;
}) {
  const fields = useMemo(() => fieldsFromSchema(nodeType?.config_schema), [nodeType]);
  const isTrigger = nodeType?.trigger === true;
  const retry = data.retry;
  const general = nodeLevel(issues);

  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold">Configure step</p>
          <p className="truncate text-[10px] text-muted-foreground">{nodeType?.label ?? data.kind}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} title="Close panel" aria-label="Close panel"><X /></Button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {general.length > 0 && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
            <p className="mb-1 flex items-center gap-1.5 font-semibold text-destructive"><TriangleAlert className="size-3.5" /> Needs attention</p>
            <ul className="list-disc space-y-0.5 pl-4 text-destructive">{general.map((i, n) => <li key={n}>{i.message}</li>)}</ul>
          </div>
        )}

        {nodeType === undefined && (
          <p role="alert" className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
            The API does not know the step type <code className="font-mono">{data.nodeType}</code>, so it cannot be configured here or published.
          </p>
        )}
        {nodeType && !nodeType.available && (
          <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
            {nodeType.label} is not available yet{nodeType.unavailable_reason ? `: ${nodeType.unavailable_reason}` : "."} It can sit on the canvas, but the workflow cannot be published with it.
          </p>
        )}

        <div className="config-section">
          <Label htmlFor="node-name" className="config-label">Display name</Label>
          <Input id="node-name" maxLength={255} disabled={readOnly} value={data.label} onChange={(e) => onRename(e.target.value)} />
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            ID <code className="font-mono">{id}</code>
            <button type="button" aria-label="Copy step id" title="Copy" onClick={() => copy(id)} className="rounded p-0.5 hover:bg-accent"><Copy className="size-3" /></button>
            <span>stays the same when you rename</span>
          </p>
        </div>

        {nodeType && nodeType.available && (
          <SchemaForm fields={fields} config={data.config as Config | undefined} onChange={onConfig} issues={issues} disabled={readOnly} />
        )}

        {isTrigger ? (
          <div className="config-section">
            <p className="config-label">Output</p>
            <p className="text-[11px] text-muted-foreground">
              Later steps read the payload with <code className="font-mono">{`{{ nodes.${id}.body }}`}</code>.
            </p>
          </div>
        ) : (
          <>
            <div className="config-section">
              <p className="config-label">Data available to this step</p>
              <div className="flex flex-wrap gap-1.5">
                <DataChip text="{{ input }}" onCopy={copy} />
                {upstream.map((u) => <DataChip key={u.id} text={`{{ nodes.${u.id} }}`} title={u.label} onCopy={copy} />)}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Click to copy, then add the field you need, like <code className="font-mono">.status</code>.</p>
            </div>

            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="retry-switch" className="text-xs font-medium">Retry on failure</Label>
                  <p className="text-[10px] text-muted-foreground">{retry ? `Up to ${retry.max_attempts} attempts` : "Off: one failure stops the run"}</p>
                </div>
                <Switch id="retry-switch" disabled={readOnly} checked={!!retry} onCheckedChange={(on) => onRetry(on ? DEFAULT_RETRY : undefined)} />
              </div>
              {retry && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="retry-attempts" className="config-label">Max attempts</Label>
                    <Input
                      id="retry-attempts" type="number" min={1} max={10} step={1} disabled={readOnly} value={retry.max_attempts}
                      onChange={(e) => { const n = Math.trunc(Number(e.target.value)); if (n >= 1 && n <= 10) onRetry({ ...retry, max_attempts: n }); }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="retry-backoff" className="config-label">Wait (seconds)</Label>
                    <Input
                      id="retry-backoff" type="number" min={0} max={3600} step={1} disabled={readOnly} value={retry.backoff_seconds ?? 0}
                      onChange={(e) => { const n = Math.trunc(Number(e.target.value)); if (n >= 0 && n <= 3600) onRetry({ ...retry, backoff_seconds: n }); }}
                    />
                  </div>
                  <p className="col-span-2 text-[11px] text-muted-foreground">A worker crash counts as a failed attempt.</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {!readOnly && (
        <div className="shrink-0 border-t border-border p-4">
          <Button variant="outline" size="sm" className="w-full text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 /> Delete step
          </Button>
        </div>
      )}
    </>
  );
}

function DataChip({ text, title, onCopy }: { text: string; title?: string; onCopy: (t: string) => void }) {
  return (
    <button type="button" title={title ? `Copy reference to “${title}”` : "Copy"} onClick={() => onCopy(text)}
      className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] hover:bg-accent">
      {text}
    </button>
  );
}
