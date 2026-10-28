"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExecutionDetail, RunStatus } from "@/lib/data/executions";

const statusClass: Record<RunStatus, string> = {
  Succeeded: "run-success",
  Running: "run-running",
  Failed: "run-failed",
};

const statusText: Record<RunStatus, string> = {
  Succeeded: "text-success",
  Running: "text-info",
  Failed: "text-destructive",
};

function StepIcon({ status }: { status: RunStatus }) {
  if (status === "Failed") return <XCircle className="text-destructive" />;
  if (status === "Running") return <Loader2 className="animate-spin text-info" />;
  return <CheckCircle2 />;
}

export function ExecutionDetailView({ execution }: { execution: ExecutionDetail }) {
  const { steps } = execution;
  // Default to the last step, which is the failed or running one when relevant.
  const [selected, setSelected] = useState(() => {
    const i = steps.findIndex((s) => s.status !== "Succeeded");
    return i === -1 ? Math.min(2, steps.length - 1) : i;
  });
  const step = steps[selected];

  const summaryLabel =
    execution.status === "Succeeded" ? `Succeeded in ${execution.duration}`
    : execution.status === "Failed" ? `Failed after ${execution.duration}`
    : `Running · ${execution.duration}`;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Execution trace</h2>
            <p>{execution.id} · {execution.workflow}</p>
          </div>
          <span className={cn("run-status", statusClass[execution.status])}>
            <span />{summaryLabel}
          </span>
        </div>
        <div className="p-4 sm:p-6">
          {steps.map((s, index) => (
            <button
              type="button"
              key={s.name}
              onClick={() => setSelected(index)}
              aria-pressed={index === selected}
              className={cn(
                "trace-step w-full text-left",
                index === selected && "rounded-md bg-accent/50"
              )}
            >
              <div className="trace-line"><StepIcon status={s.status} /></div>
              <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{s.name}</p>
                  <span className="text-[10px] text-muted-foreground">{s.kind}</span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">{s.duration}</span>
              </div>
              {index < steps.length - 1 && <div className="trace-connector" />}
            </button>
          ))}
        </div>
      </section>

      <section className="panel self-start">
        <div className="panel-header">
          <div>
            <h2>Step output</h2>
            <p>{step.name}</p>
          </div>
        </div>
        <div className="p-4">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="detail-stat">
              <span>Status</span>
              <strong className={statusText[step.status]}>{step.status}</strong>
            </div>
            <div className="detail-stat">
              <span>Attempt</span>
              <strong>{step.attempt}</strong>
            </div>
          </div>
          <pre className="execution-code">{JSON.stringify(step.output, null, 2)}</pre>
        </div>
      </section>
    </div>
  );
}