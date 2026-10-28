// The workflow definition format (see schemas/) and the converter between it and
// the canvas (React Flow). Pure: no React, no DOM. The shared fixtures in
// schemas/fixtures are also checked by the Go and Python validators.

export type RetryPolicy = { max_attempts: number; backoff_seconds?: number };
export type Pos = { x: number; y: number };
export type DefNode = {
  id: string;
  type: string;
  name?: string;
  config?: Record<string, unknown>;
  retry?: RetryPolicy;
  ui?: Pos;
};
export type DefEdge = {
  from: string;
  to: string;
  label?: string;
  ui?: { source_handle?: string; target_handle?: string };
};
export type Definition = { schema_version: 1; nodes: DefNode[]; edges: DefEdge[] };

// ---- canvas shapes ---------------------------------------------------------
// Structurally compatible with @xyflow/react's Node/Edge, without importing it.
export type NodeData = {
  label: string; // display name; the stable id is the node's `id`
  description: string; // subtitle on the card, derived from config
  kind: string; // human label of the node type
  icon: string;
  nodeType: string; // the definition's `type`
  config?: Record<string, unknown>;
  retry?: RetryPolicy;
  status?: "idle" | "running" | "success" | "failure"; // runtime overlay, never saved
  [key: string]: unknown;
};
export type FlowNode = { id: string; type: "flowNode"; position: Pos; data: NodeData };
export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
};

// Looser input types for fromFlow, so an @xyflow Node/Edge can be passed directly.
export type NodeLike = {
  id: string;
  position: Pos;
  data: { label: string; nodeType: string; config?: Record<string, unknown>; retry?: RetryPolicy };
};
export type EdgeLike = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: unknown;
};
export type Link = { source: string; target: string };

const SIDES = ["top", "right", "bottom", "left"] as const;
const DEFAULT_SOURCE = "right";
const DEFAULT_TARGET = "left";

const META: Record<string, { kind: string; icon: string }> = {
  webhook: { kind: "Webhook", icon: "webhook" },
  schedule: { kind: "Schedule", icon: "action" },
  http: { kind: "HTTP Request", icon: "http" },
  condition: { kind: "Condition", icon: "condition" },
  code: { kind: "Code", icon: "code" },
  ai_classifier: { kind: "AI Classifier", icon: "ai" },
  generate_text: { kind: "Generate text", icon: "ai" },
};

export function describe(type: string, config?: Record<string, unknown>): string {
  if (type === "http" && typeof config?.url === "string" && config.url) {
    const method = typeof config.method === "string" ? config.method : "GET";
    return `${method} ${config.url}`;
  }
  return "Configure this step";
}

const side = (v: string | null | undefined, fallback: string): string =>
  v && (SIDES as readonly string[]).includes(v) ? v : fallback;

// ---- layout ------------------------------------------------------------------
/** Positions for drafts that have none (e.g. created through the API): columns by
 *  longest path from a source, rows in definition order. Cycles cannot hang it. */
export function autoLayout(def: Definition): Record<string, Pos> {
  const ids = def.nodes.map((n) => n.id);
  const indeg = new Map(ids.map((i) => [i, 0]));
  const next = new Map<string, string[]>(ids.map((i) => [i, []]));
  for (const e of def.edges) {
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue;
    next.get(e.from)!.push(e.to);
    indeg.set(e.to, indeg.get(e.to)! + 1);
  }
  const layer = new Map<string, number>(ids.map((i) => [i, 0]));
  const queue = ids.filter((i) => indeg.get(i) === 0);
  const done = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!;
    done.add(cur);
    for (const n of next.get(cur)!) {
      layer.set(n, Math.max(layer.get(n)!, layer.get(cur)! + 1));
      indeg.set(n, indeg.get(n)! - 1);
      if (indeg.get(n) === 0) queue.push(n);
    }
  }
  const maxLayer = Math.max(0, ...[...done].map((i) => layer.get(i)!));
  for (const i of ids) if (!done.has(i)) layer.set(i, maxLayer + 1); // nodes in a cycle go last

  const rows = new Map<number, number>();
  const out: Record<string, Pos> = {};
  for (const i of ids) {
    const col = layer.get(i)!;
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    out[i] = { x: 50 + col * 290, y: 120 + row * 140 };
  }
  return out;
}

export function withLayout(def: Definition): Definition {
  const pos = autoLayout(def);
  return { ...def, nodes: def.nodes.map((n) => (n.ui ? n : { ...n, ui: pos[n.id] })) };
}

// ---- canonical form ---------------------------------------------------------------
/** The one canonical shape: positions rounded to whole pixels, `name` omitted when
 *  it equals the id, default edge sides and empty labels omitted, fixed key order.
 *  Saving always writes this form, so diffs between versions show only real changes. */
export function normalize(def: Definition): Definition {
  return {
    schema_version: 1,
    nodes: def.nodes.map((n) => {
      const out: DefNode = { id: n.id, type: n.type };
      if (n.name && n.name !== n.id) out.name = n.name;
      if (n.config !== undefined) out.config = n.config;
      if (n.retry !== undefined) out.retry = n.retry;
      if (n.ui) out.ui = { x: Math.round(n.ui.x), y: Math.round(n.ui.y) };
      return out;
    }),
    edges: def.edges.map((e) => {
      const out: DefEdge = { from: e.from, to: e.to };
      if (e.label) out.label = e.label;
      const s = side(e.ui?.source_handle, DEFAULT_SOURCE);
      const t = side(e.ui?.target_handle, DEFAULT_TARGET);
      if (s !== DEFAULT_SOURCE || t !== DEFAULT_TARGET) out.ui = { source_handle: s, target_handle: t };
      return out;
    }),
  };
}

// ---- conversion -------------------------------------------------------------------
export function toFlow(def: Definition): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const laid = withLayout(def);
  const nodes: FlowNode[] = laid.nodes.map((n) => {
    const meta = META[n.type] ?? { kind: n.type, icon: "action" };
    const data: NodeData = {
      label: n.name ?? n.id,
      description: describe(n.type, n.config),
      kind: meta.kind,
      icon: meta.icon,
      nodeType: n.type,
    };
    if (n.config !== undefined) data.config = n.config;
    if (n.retry !== undefined) data.retry = n.retry;
    return { id: n.id, type: "flowNode", position: { x: n.ui!.x, y: n.ui!.y }, data };
  });

  const seen = new Map<string, number>();
  const edges: FlowEdge[] = def.edges.map((e) => {
    const base = `e-${e.from}-${e.to}`;
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    const edge: FlowEdge = {
      id: k === 1 ? base : `${base}#${k}`,
      source: e.from,
      target: e.to,
      sourceHandle: side(e.ui?.source_handle, DEFAULT_SOURCE),
      targetHandle: side(e.ui?.target_handle, DEFAULT_TARGET),
    };
    if (e.label) edge.label = e.label;
    return edge;
  });
  return { nodes, edges };
}

export function fromFlow(nodes: NodeLike[], edges: EdgeLike[]): Definition {
  return normalize({
    schema_version: 1,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.nodeType,
      name: n.data.label,
      config: n.data.config,
      retry: n.data.retry,
      ui: n.position,
    })),
    edges: edges.map((e) => ({
      from: e.source,
      to: e.target,
      label: typeof e.label === "string" ? e.label : undefined,
      ui: { source_handle: e.sourceHandle ?? undefined, target_handle: e.targetHandle ?? undefined },
    })),
  });
}

// ---- cycle checks (the canvas allows connecting any handle to any handle) --------
export function hasCycle(nodeIds: string[], links: Link[]): boolean {
  const indeg = new Map(nodeIds.map((i) => [i, 0]));
  const next = new Map<string, string[]>(nodeIds.map((i) => [i, []]));
  for (const l of links) {
    if (!indeg.has(l.source) || !indeg.has(l.target)) continue;
    next.get(l.source)!.push(l.target);
    indeg.set(l.target, indeg.get(l.target)! + 1);
  }
  const queue = nodeIds.filter((i) => indeg.get(i) === 0);
  let visited = 0;
  while (queue.length) {
    const cur = queue.shift()!;
    visited++;
    for (const n of next.get(cur)!) {
      indeg.set(n, indeg.get(n)! - 1);
      if (indeg.get(n) === 0) queue.push(n);
    }
  }
  return visited !== nodeIds.length;
}

/** Would adding source -> target create a cycle? (Reject the connection if so.) */
export function wouldCreateCycle(links: Link[], source: string, target: string): boolean {
  if (source === target) return true;
  const next = new Map<string, string[]>();
  for (const l of links) next.set(l.source, [...(next.get(l.source) ?? []), l.target]);
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(next.get(cur) ?? []));
  }
  return false;
}
