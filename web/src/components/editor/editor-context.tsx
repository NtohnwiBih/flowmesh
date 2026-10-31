"use client";

import { createContext, useContext } from "react";
import type { Edge } from "@xyflow/react";

import type { Issue } from "@/lib/api/types";
import type { Side } from "@/lib/editor-ops";

// What a node card needs from the editor without threading props through React Flow.
export type EditorContextValue = {
  edges: Edge[];
  issues: Map<string, Issue[]>; // validation problems by node id
  readOnly: boolean;
  openPicker: (nodeId: string, side: Side) => void;
};

export const EditorContext = createContext<EditorContextValue>({
  edges: [],
  issues: new Map(),
  readOnly: true,
  openPicker: () => {},
});

export const useEditorContext = () => useContext(EditorContext);
