"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Edge } from "@xyflow/react";
import { toast } from "sonner";

import type { WorkflowLog } from "@/components/workflow-logs";
import { executionOrder } from "@/lib/editor-ops";
import type { RFNode } from "./node-card";

export type DryState = "idle" | "running" | "success" | "failure";

/** A timer-driven preview of how a run would flow through the graph.
 *  It never contacts the API: real runs arrive with the execution inspector. */
export function useDryRun({
  nodes, edges, setNodes, setEdges, environment,
}: {
  nodes: RFNode[];
  edges: Edge[];
  setNodes: Dispatch<SetStateAction<RFNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  environment: string;
}) {
  const [state, setState] = useState<DryState>("idle");
  const [completed, setCompleted] = useState(0);
  const [logs, setLogs] = useState<WorkflowLog[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logId = useRef(0);

  const log = useCallback((level: WorkflowLog["level"], message: string) => {
    const entry: WorkflowLog = { id: ++logId.current, time: new Date().toLocaleTimeString("en-GB", { hour12: false }), level, message };
    setLogs((items) => [...items, entry]);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const run = useCallback((simulateFailure = false) => {
    if (state === "running" || nodes.length === 0) return;
    const order = executionOrder(nodes, edges);
    if (!order) {
      log("error", "Dry run blocked: the workflow contains a loop.");
      toast.error("Cannot run a workflow with a loop");
      return;
    }
    const failedId = simulateFailure ? order[order.length - 1] : undefined;
    setLogs([]);
    log("info", `Dry run started · ${environment} · ${order.length} steps (preview only, nothing is executed)`);
    setState("running");
    setCompleted(0);
    setNodes((items) => items.map((n) => ({ ...n, data: { ...n.data, status: "idle" } })));
    setEdges((items) => items.map((e) => ({ ...e, className: "", animated: false })));
    toast.info("Dry run started", { description: "A preview only. Nothing is executed." });

    const advance = (index: number) => {
      const id = order[index];
      if (!id) {
        setState(simulateFailure ? "failure" : "success");
        timer.current = null;
        log(simulateFailure ? "error" : "success", simulateFailure ? "Dry run ended with a simulated failure." : `Dry run finished · ${order.length} steps.`);
        return;
      }
      const label = nodes.find((n) => n.id === id)?.data.label || id;
      log("info", `[${index + 1}/${order.length}] ${label} · started`);
      setNodes((items) => items.map((n) => (n.id === id ? { ...n, data: { ...n.data, status: "running" } } : n)));
      setEdges((items) => items.map((e) => (e.target === id ? { ...e, className: "flow-edge-running", animated: true } : e)));
      timer.current = setTimeout(() => {
        const status = id === failedId ? "failure" : "success";
        log(status === "failure" ? "error" : "success", `${label} · ${status === "failure" ? "simulated failure" : "completed"}`);
        setNodes((items) => items.map((n) => (n.id === id ? { ...n, data: { ...n.data, status } } : n)));
        setEdges((items) => items.map((e) => (e.target === id ? { ...e, className: `flow-edge-${status}`, animated: false } : e)));
        setCompleted(index + 1);
        timer.current = setTimeout(() => advance(index + 1), 250);
      }, 850);
    };
    advance(0);
  }, [state, nodes, edges, setNodes, setEdges, environment, log]);

  return { state, completed, logs, run, clearLogs: () => setLogs([]) };
}
