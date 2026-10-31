"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NodeType } from "@/lib/api/types";
import { TypeList } from "./type-list";

/** The panel opened by the "+" on a node's connector: pick what to add next to it. */
export function AddStepPanel({
  types, fromLabel, side, onPick, onClose,
}: { types: NodeType[]; fromLabel: string; side: string; onPick: (t: NodeType) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold">Add connected step</p>
          <p className="truncate text-[10px] text-muted-foreground">From “{fromLabel}” · {side} connector</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} title="Close panel" aria-label="Close panel"><X /></Button>
      </div>
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input autoFocus className="h-8 pl-8 text-xs" placeholder="Search steps" aria-label="Search steps" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <TypeList types={types} query={query} onPick={onPick} hideTriggers />
      </div>
    </>
  );
}
