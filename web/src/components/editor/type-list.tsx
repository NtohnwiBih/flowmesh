"use client";

import { GripVertical, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NodeType } from "@/lib/api/types";
import { NodeIcon } from "./icons";

export const DRAG_TYPE = "application/flowmesh";

/** The node catalog as a grouped list. Used by the left palette and the "add connected step" panel. */
export function TypeList({
  types, query = "", onPick, draggable = false, hideTriggers = false,
}: {
  types: NodeType[];
  query?: string;
  onPick: (t: NodeType) => void;
  draggable?: boolean; // the palette drags; the connected-step panel only clicks
  hideTriggers?: boolean; // nothing can connect into a trigger
}) {
  const q = query.trim().toLowerCase();
  const shown = types.filter(
    (t) => (!hideTriggers || !t.trigger) && (q === "" || t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)),
  );
  const groups = [...new Set(shown.map((t) => t.category))].map((name) => ({ name, items: shown.filter((t) => t.category === name) }));

  if (groups.length === 0) return <p className="py-6 text-center text-xs text-muted-foreground">No matching steps</p>;

  return (
    <>
      {groups.map((g) => (
        <div className="mb-5" key={g.name}>
          <div className="mb-2 px-1 text-[10px] font-semibold uppercase text-muted-foreground">{g.name}</div>
          <ul className="space-y-1">
            {g.items.map((t) => {
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={!t.available}
                    draggable={draggable && t.available}
                    onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, t.id); e.dataTransfer.effectAllowed = "move"; }}
                    onClick={() => onPick(t)}
                    title={t.available ? t.description : (t.unavailable_reason ?? "Not available yet")}
                    className={cn("node-library-item w-full text-left", !t.available && "cursor-not-allowed opacity-55 hover:border-transparent hover:bg-transparent")}
                  >
                    <NodeIcon name={t.icon} className="size-4 text-primary" />
                    <span className="flex-1 truncate">{t.label}</span>
                    {t.available
                      ? (draggable ? <GripVertical className="size-3.5 text-muted-foreground/60" /> : <Plus className="size-3.5 text-muted-foreground" />)
                      : <span className="rounded-full border border-border px-1.5 py-px text-[9px] text-muted-foreground">Soon</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}
