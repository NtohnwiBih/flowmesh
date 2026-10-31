"use client";

import { useState } from "react";
import { Blocks, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { NodeType } from "@/lib/api/types";
import { TypeList } from "./type-list";

export function Palette({ types, onAdd, readOnly }: { types: NodeType[]; onAdd: (t: NodeType) => void; readOnly: boolean }) {
  const [query, setQuery] = useState("");
  return (
    <div className="p-3">
      <div className="relative mb-4">
        <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
        <Input className="h-8 pl-8 text-xs" placeholder="Search steps" aria-label="Search steps" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {readOnly
        ? <p className="px-1 text-xs text-muted-foreground">This view is read-only, so steps cannot be added.</p>
        : <TypeList types={types} query={query} onPick={onAdd} draggable />}
      <div className="mb-5 mt-2">
        <div className="mb-2 px-1 text-[10px] font-semibold uppercase text-muted-foreground">Integrations</div>
        <div className="node-library-item cursor-not-allowed opacity-55" title="App integrations arrive in a later phase" aria-disabled="true">
          <Blocks className="size-4 text-primary" /><span className="flex-1">Integrations</span>
          <span className="rounded-full border border-border px-1.5 py-px text-[9px] text-muted-foreground">Soon</span>
        </div>
      </div>
    </div>
  );
}
