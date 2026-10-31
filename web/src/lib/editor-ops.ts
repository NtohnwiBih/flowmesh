// Pure operations on the canvas graph: add, connect, remove. No React, no DOM.
// The rules here mirror what the API enforces at publish time, so people find out
// while they are drawing instead of when they press Publish.

import { describe, hasCycle, wouldCreateCycle, type FlowEdge, type FlowNode, type NodeData, type Pos } from "./definition";
import { makeNodeId } from "./slug";
import type { NodeType } from "./api/types";

export type Side = "top" | "right" | "bottom" | "left";
export const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

// Generic over the library's node/edge types so React Flow's own Node and Edge fit.
type N = { id: string; position: Pos; data: NodeData };
type E = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };
type Verdict = { ok: true } | { ok: false; reason: string };

export const typesById = (types: NodeType[]) => new Map(types.map((t) => [t.id, t]));

// ---- adding -----------------------------------------------------------------------------
export function canAddNode(nodes: N[], nt: NodeType, types: Map<string, NodeType>): Verdict {
  if (!nt.available) return { ok: false, reason: nt.unavailable_reason ?? `${nt.label} is not available yet.` };
  if (nt.trigger && nodes.some((n) => types.get(n.data.nodeType)?.trigger)) {
    return { ok: false, reason: "A workflow can have only one trigger." };
  }
  return { ok: true };
}

/** Keep new nodes from landing exactly on top of existing ones. */
export function freePosition(nodes: N[], desired: Pos): Pos {
  const taken = (p: Pos) => nodes.some((n) => Math.abs(n.position.x - p.x) < 40 && Math.abs(n.position.y - p.y) < 40);
  const p = { x: Math.round(desired.x), y: Math.round(desired.y) };
  while (taken(p)) p.y += 140;
  return p;
}

/** Where a step added from a connector goes: one step over, on the side it was added from. */
export function stepPosition(from: N, side: Side): Pos {
  const d = { right: [290, 0], left: [-290, 0], top: [0, -140], bottom: [0, 140] }[side];
  return { x: from.position.x + d[0], y: from.position.y + d[1] };
}

export function nodeFromType(nt: NodeType, nodes: N[], position: Pos): FlowNode {
  const id = makeNodeId(nt.label, nodes.map((n) => n.id));
  return {
    id,
    type: "flowNode",
    position: freePosition(nodes, position),
    data: {
      label: nt.label,
      description: describe(nt.id, undefined),
      kind: nt.label,
      icon: nt.icon,
      nodeType: nt.id,
    },
  };
}

// ---- editing -------------------------------------------------------------------------------
export function patchNode<T extends N>(nodes: T[], id: string, patch: Partial<NodeData>): T[] {
  return nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
}

/** Setting the config also refreshes the card subtitle, which is derived from it. */
export function setNodeConfig<T extends N>(nodes: T[], id: string, config: Record<string, unknown> | undefined): T[] {
  return nodes.map((n) => {
    if (n.id !== id) return n;
    const data: NodeData = { ...n.data, description: describe(n.data.nodeType, config) };
    if (config === undefined) delete data.config;
    else data.config = config;
    return { ...n, data };
  });
}

export function setNodeRetry<T extends N>(nodes: T[], id: string, retry: NodeData["retry"]): T[] {
  return nodes.map((n) => {
    if (n.id !== id) return n;
    const data: NodeData = { ...n.data };
    if (retry === undefined) delete data.retry;
    else data.retry = retry;
    return { ...n, data };
  });
}

export function removeNodes<TN extends N, TE extends E>(nodes: TN[], edges: TE[], ids: string[]) {
  const gone = new Set(ids);
  return {
    nodes: nodes.filter((n) => !gone.has(n.id)),
    edges: edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
  };
}

// ---- connecting ------------------------------------------------------------------------------
export function canConnect(nodes: N[], edges: E[], types: Map<string, NodeType>, source: string, target: string): Verdict {
  if (source === target) return { ok: false, reason: "A step cannot connect to itself." };
  const from = nodes.find((n) => n.id === source);
  const to = nodes.find((n) => n.id === target);
  if (!from || !to) return { ok: false, reason: "Unknown step." };
  if (edges.some((e) => e.source === source && e.target === target)) return { ok: false, reason: "These steps are already connected." };
  if (types.get(to.data.nodeType)?.trigger) return { ok: false, reason: "A trigger starts the workflow, so nothing can connect into it." };
  if (wouldCreateCycle(edges, source, target)) return { ok: false, reason: "That would create a loop. Workflows cannot run in circles." };
  return { ok: true };
}

let counter = 0;
export function makeEdge(source: string, target: string, sourceHandle: Side = "right", targetHandle: Side = "left"): FlowEdge {
  return { id: `e-${source}-${target}-${++counter}`, source, target, sourceHandle, targetHandle };
}

/** True when the graph as drawn contains a loop. */
export const graphHasCycle = (nodes: N[], edges: E[]) =>
  hasCycle(nodes.map((n) => n.id), edges.map((e) => ({ source: e.source, target: e.target })));

/** Steps whose output reaches this one: nearest first. Used to suggest template references. */
export function ancestors(edges: E[], id: string): string[] {
  const incoming = new Map<string, string[]>();
  for (const e of edges) incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source]);
  const order: string[] = [];
  const seen = new Set<string>([id]);
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const p of incoming.get(cur) ?? []) {
        if (seen.has(p)) continue;
        seen.add(p);
        order.push(p);
        next.push(p);
      }
    }
    frontier = next;
  }
  return order;
}

/** Steps in a valid run order (everything a step needs comes before it), or null if the graph has a loop. */
export function executionOrder(nodes: N[], edges: E[]): string[] | null {
  const remaining = new Set(nodes.map((n) => n.id));
  const order: string[] = [];
  while (remaining.size) {
    const ready = nodes.filter((n) => remaining.has(n.id) && !edges.some((e) => e.target === n.id && remaining.has(e.source)));
    if (ready.length === 0) return null;
    for (const n of ready) {
      remaining.delete(n.id);
      order.push(n.id);
    }
  }
  return order;
}
