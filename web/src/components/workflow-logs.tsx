import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type WorkflowLog = {
  id: number;
  time: string;
  level: "info" | "success" | "error";
  message: string;
};

export function WorkflowLogs({ logs, running, onClear }: { logs: WorkflowLog[]; running: boolean; onClear: () => void }) {
  const [open, setOpen] = useState(true);
  const output = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [logs, open]);

  return (
    <section aria-label="Workflow logs terminal" className="shrink-0 border-t border-border bg-surface">
      <div className="flex h-10 items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Terminal className="size-3.5 text-muted-foreground" />
          <h2 className="text-xs font-semibold">Logs</h2>
          <span className="font-mono text-[10px] text-muted-foreground">{logs.length}</span>
          {running && <span className="flex items-center gap-1.5 text-[10px] text-warning"><span className="size-1.5 animate-pulse rounded-full bg-warning" />Running</span>}
        </div>
        <div className="flex items-center gap-1">
          <span className="hidden text-[10px] text-muted-foreground sm:inline">Dry run (preview)</span>
          <Button variant="ghost" size="icon" className="size-7" aria-label="Clear logs" title="Clear logs" disabled={!logs.length} onClick={onClear}><Trash2 className="size-3.5" /></Button>
          <Button variant="ghost" size="icon" className="size-7" aria-label={open ? "Collapse logs" : "Expand logs"} title={open ? "Collapse logs" : "Expand logs"} aria-expanded={open} aria-controls="workflow-log-output" onClick={() => setOpen((value) => !value)}>{open ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}</Button>
        </div>
      </div>
      {open && <div id="workflow-log-output" ref={output} role="log" aria-live="polite" aria-relevant="additions" tabIndex={0} className="h-40 overflow-auto bg-workspace px-3 py-2 font-mono text-[11px] leading-6">
        {!logs.length && <p className="text-muted-foreground">Waiting for execution…</p>}
        {logs.map((log) => <div key={log.id} className="flex items-start gap-3">
          <time className="shrink-0 text-muted-foreground">{log.time}</time>
          <span className={cn("w-12 shrink-0 uppercase", log.level === "info" && "text-info", log.level === "success" && "text-success", log.level === "error" && "text-destructive")}>{log.level === "success" ? "OK" : log.level}</span>
          <span className={cn("min-w-0 break-words", log.level === "error" ? "text-destructive" : "text-foreground")}>{log.message}</span>
        </div>)}
      </div>}
    </section>
  );
}