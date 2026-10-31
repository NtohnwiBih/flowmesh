"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Check, LoaderCircle, MoreHorizontal, Plus, TriangleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NodeData } from "@/lib/definition";
import type { Side } from "@/lib/editor-ops";
import { useEditorContext } from "./editor-context";
import { NodeIcon } from "./icons";

export type RFNode = Node<NodeData>;

const SIDES: { id: Side; pos: Position }[] = [
  { id: "top", pos: Position.Top },
  { id: "right", pos: Position.Right },
  { id: "bottom", pos: Position.Bottom },
  { id: "left", pos: Position.Left },
];

export function FlowNodeCard({ id, data, selected }: NodeProps<RFNode>) {
  const { edges, issues, readOnly, openPicker } = useEditorContext();
  const problems = issues.get(id) ?? [];
  const used = (side: Side) =>
    edges.some((e) => (e.source === id && e.sourceHandle === side) || (e.target === id && e.targetHandle === side));

  return (
    <div
      data-status={data.status ?? "idle"}
      data-testid={`node-${id}`}
      className={cn(
        "flow-node group relative",
        selected && "flow-node-selected",
        data.status && `flow-node-${data.status}`,
        problems.length > 0 && "border-destructive ring-2 ring-destructive/25",
      )}
    >
      {SIDES.map((s) => <Handle key={s.id} id={s.id} type="source" position={s.pos} />)}

      {/* "+" stubs appear on connector sides that are still free */}
      {!readOnly && SIDES.filter((s) => !used(s.id)).map((s) => (
        <div key={`add-${s.id}`} className={cn("node-add-stub nodrag nopan", `node-add-${s.id}`)}>
          <span className="node-add-line" />
          <Button
            variant="outline" size="icon" type="button" className="node-add-btn"
            title="Add connected step" aria-label={`Add step ${s.id}`}
            onClick={(e) => { e.stopPropagation(); openPicker(id, s.id); }}
          >
            <Plus />
          </Button>
        </div>
      ))}

      {problems.length > 0 && (
        <span
          className="absolute -right-2 -top-2 flex items-center gap-0.5 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-white shadow"
          title={problems.map((p) => p.message).join("\n")}
          aria-label={`${problems.length} problem${problems.length === 1 ? "" : "s"}`}
        >
          <TriangleAlert className="size-3" />{problems.length}
        </span>
      )}

      <div className="flow-node-icon"><NodeIcon name={data.icon} /></div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="truncate text-xs font-semibold text-foreground">{data.label || id}</span>
          {data.status === "success" && <Check className="size-3 text-success" />}
          {data.status === "failure" && <X className="size-3 text-destructive" />}
          {data.status === "running" && <LoaderCircle className="size-3 animate-spin text-warning" />}
        </div>
        <p className="truncate font-mono text-[10px] text-muted-foreground">{data.description}</p>
      </div>
      <MoreHorizontal className="size-4 text-muted-foreground" />
    </div>
  );
}
