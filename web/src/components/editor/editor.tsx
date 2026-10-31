"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background, BackgroundVariant, ConnectionMode, Controls, MiniMap, ReactFlow,
  useEdgesState, useNodesState,
  type Connection, type Edge, type FinalConnectionState, type ReactFlowInstance,
} from "@xyflow/react";
import { toast } from "sonner";

import { WorkflowLogs } from "@/components/workflow-logs";
import type { NodeType } from "@/lib/api/types";
import { fromFlow, toFlow, type Definition, type Pos } from "@/lib/definition";
import {
  OPPOSITE, ancestors, canAddNode, canConnect, makeEdge, nodeFromType, patchNode, removeNodes,
  setNodeConfig, setNodeRetry, stepPosition, typesById, type Side,
} from "@/lib/editor-ops";
import { issuesByNode } from "@/lib/issues";
import { EnvironmentBanner, type View } from "./banner";
import { ConfigPanel } from "./config-panel";
import { AddStepPanel } from "./add-step-panel";
import { ConflictDialog, PublishDialog } from "./dialogs";
import { EditorContext, type EditorContextValue } from "./editor-context";
import { FlowNodeCard, type RFNode } from "./node-card";
import { Palette } from "./palette";
import { DRAG_TYPE } from "./type-list";
import { EditorToolbar, type SaveState } from "./toolbar";
import { useDraftActions, type DraftMeta } from "./use-draft-actions";
import { useDryRun } from "./use-dry-run";

const NODE_TYPES = { flowNode: FlowNodeCard };

export type WorkflowEditorProps = {
  workflow: { id: string; name: string; is_active: boolean };
  definition: Definition; // what to show: the draft, or the live version
  view: View; // which copy this is
  canEdit: boolean; // does the caller's role allow editing?
  draft: DraftMeta;
  nodeTypes: NodeType[];
  onSwitchView: (to: View) => void;
  onReload: () => void; // discard local state and load the draft again
  onPublished?: (version: number) => void;
};

export function WorkflowEditor({ workflow, definition, view, canEdit, draft, nodeTypes, onSwitchView, onReload, onPublished }: WorkflowEditorProps) {
  const readOnly = view === "production" || !canEdit;
  const types = useMemo(() => typesById(nodeTypes), [nodeTypes]);

  // The canvas copies the definition once, on mount. After that the canvas is the source of truth.
  const [initial] = useState(() =>
    toFlow(definition, (t) => { const nt = types.get(t); return nt ? { kind: nt.label, icon: nt.icon } : undefined; }),
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [flow, setFlow] = useState<ReactFlowInstance<RFNode, Edge> | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"config" | "picker" | null>(null);
  const [picker, setPicker] = useState<{ nodeId: string; side: Side } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const [loaded] = useState(() => fromFlow(initial.nodes, initial.edges)); // the canonical form of what was loaded
  const current = useMemo(() => fromFlow(nodes, edges), [nodes, edges]);
  const actions = useDraftActions({
    workflowId: workflow.id,
    definition: current,
    readOnly,
    initialMeta: draft,
    initialDefinition: loaded,
    onPublished,
  });
  const dry = useDryRun({ nodes, edges, setNodes, setEdges, environment: view === "staging" ? "Staging" : "Production" });
  const running = dry.state === "running";
  const locked = readOnly || running;

  const issueMap = useMemo(() => issuesByNode(actions.issues), [actions.issues]);
  const selected = nodes.find((n) => n.id === selectedId);
  const labelOf = useCallback((id: string) => nodes.find((n) => n.id === id)?.data.label || id, [nodes]);

  // ---- leaving with unsaved work, and Ctrl/Cmd+S -------------------------------------------
  useEffect(() => {
    if (!actions.dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [actions.dirty]);

  const { save, dirty } = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, save]);

  // ---- adding and connecting ------------------------------------------------------------------
  const centerSpot = useCallback((): Pos => {
    const rect = wrapper.current?.getBoundingClientRect();
    if (!flow || !rect) return { x: 50, y: 120 };
    const p = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    return { x: p.x - 110, y: p.y - 30 };
  }, [flow]);

  const select = useCallback((id: string) => {
    setNodes((items) => items.map((n) => ({ ...n, selected: n.id === id })));
    setSelectedId(id);
    setPicker(null);
    setPanel("config");
  }, [setNodes]);

  const addStep = useCallback((nt: NodeType, at?: Pos) => {
    const verdict = canAddNode(nodes, nt, types);
    if (!verdict.ok) { toast.error(verdict.reason); return; }
    const node = nodeFromType(nt, nodes, at ?? centerSpot());
    setNodes((items) => [...items.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
    setSelectedId(node.id);
    setPicker(null);
    setPanel("config");
  }, [nodes, types, centerSpot, setNodes]);

  const addConnected = useCallback((nt: NodeType) => {
    const from = picker && nodes.find((n) => n.id === picker.nodeId);
    if (!picker || !from) return;
    const verdict = canAddNode(nodes, nt, types);
    if (!verdict.ok) { toast.error(verdict.reason); return; }
    const node = nodeFromType(nt, nodes, stepPosition(from, picker.side));
    setNodes((items) => [...items.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
    setEdges((items) => [...items, makeEdge(from.id, node.id, picker.side, OPPOSITE[picker.side])]);
    setSelectedId(node.id);
    setPicker(null);
    setPanel("config");
  }, [picker, nodes, types, setNodes, setEdges]);

  const onConnect = useCallback((c: Connection) => {
    const verdict = canConnect(nodes, edges, types, c.source, c.target);
    if (!verdict.ok) { toast.error(verdict.reason); return; }
    setEdges((items) => [...items, makeEdge(c.source, c.target, (c.sourceHandle as Side) ?? "right", (c.targetHandle as Side) ?? "left")]);
  }, [nodes, edges, types, setEdges]);

  // React Flow only asks yes/no while dragging; this explains a "no" when the line is released.
  const onConnectEnd = useCallback((_: MouseEvent | TouchEvent, s: FinalConnectionState) => {
    if (s.isValid === false && s.fromNode && s.toNode) {
      const verdict = canConnect(nodes, edges, types, s.fromNode.id, s.toNode.id);
      if (!verdict.ok) toast.error(verdict.reason);
    }
  }, [nodes, edges, types]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (locked || !flow) return;
    const nt = types.get(e.dataTransfer.getData(DRAG_TYPE));
    if (!nt) return;
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addStep(nt, { x: p.x - 110, y: p.y - 30 });
  };

  const focusNode = (id: string) => {
    select(id);
    void flow?.fitView({ nodes: [{ id }], duration: 300, maxZoom: 1.1, padding: 0.6 });
  };

  const deleteSelected = () => {
    if (!selected) return;
    const next = removeNodes(nodes, edges, [selected.id]);
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelectedId(null);
    setPanel(null);
  };

  const ctx: EditorContextValue = useMemo(() => ({
    edges, issues: issueMap, readOnly: locked,
    openPicker: (nodeId, side) => { setPicker({ nodeId, side }); setPanel("picker"); },
  }), [edges, issueMap, locked]);

  const saveState: SaveState = readOnly ? "readonly" : actions.saving ? "saving" : actions.dirty ? "dirty" : "saved";
  const production = actions.meta.production_version;
  const hasUnpublished = actions.dirty || actions.meta.has_unpublished_changes;
  const subtitle = `${view === "staging" ? "Staging draft" : "Production"} · ${production ? `v${production} live` : "not published"}`;
  const upstream = selected ? ancestors(edges, selected.id).map((id) => ({ id, label: labelOf(id) })) : [];
  const rightPanel = panel === "picker" && picker ? "picker" : panel === "config" && selected ? "config" : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-workspace">
      <EditorToolbar
        title={workflow.name} isActive={workflow.is_active} subtitle={subtitle}
        saveState={saveState} readOnly={readOnly}
        canSave={!readOnly && actions.dirty && !actions.saving}
        canPublish={!readOnly && !actions.publishing && !actions.saving && hasUnpublished && nodes.length > 0}
        validating={actions.validating} publishing={actions.publishing} dryRunning={running}
        problems={actions.issues} labelOf={labelOf}
        onValidate={actions.validate} onSave={() => void actions.save()} onPublish={() => setPublishOpen(true)}
        onDryRun={dry.run} onFocusNode={focusNode}
      />
      <EnvironmentBanner view={view} canEdit={canEdit} productionVersion={production} hasUnpublished={hasUnpublished} onSwitch={onSwitchView} />

      {/* "relative" matters: without it the side panels anchor to the whole page and cover the toolbar */}
      <div className="relative flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-border bg-surface md:block" aria-label="Steps">
          <Palette types={nodeTypes} onAdd={addStep} readOnly={locked} />
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={wrapper} className="relative min-h-0 min-w-0 flex-1" onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}>
            <EditorContext.Provider value={ctx}>
              <ReactFlow<RFNode, Edge>
                nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} onInit={setFlow}
                onNodesChange={(c) => { if (!running) onNodesChange(c); }}
                onEdgesChange={(c) => { if (!running) onEdgesChange(c); }}
                nodesDraggable={!locked} nodesConnectable={!locked}
                deleteKeyCode={locked ? null : ["Backspace", "Delete"]}
                isValidConnection={(c) => canConnect(nodes, edges, types, c.source, c.target).ok}
                onConnect={onConnect} onConnectEnd={onConnectEnd} connectionMode={ConnectionMode.Loose}
                onNodeClick={(_, n) => select(n.id)}
                onPaneClick={() => { setPanel(null); setPicker(null); }}
                fitView fitViewOptions={{ padding: 0.16 }} minZoom={0.35} maxZoom={1.5}
                defaultEdgeOptions={{ type: "smoothstep" }} proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
                <Controls position="bottom-left" showInteractive={false} />
                {/* size goes through `style`: the minimap derives its internal viewBox from it, so a CSS override distorts it */}
                <MiniMap position="bottom-right" pannable zoomable className="flow-minimap" style={{ width: 128, height: 84 }} />
              </ReactFlow>
            </EditorContext.Provider>
          </div>
          <WorkflowLogs logs={dry.logs} running={running} onClear={dry.clearLogs} />
        </div>

        {rightPanel && (
          <aside className="flex w-[340px] max-w-[85vw] shrink-0 flex-col border-l border-border bg-surface" aria-label="Step panel">
            {rightPanel === "picker" && picker ? (
              <AddStepPanel types={nodeTypes} fromLabel={labelOf(picker.nodeId)} side={picker.side} onPick={addConnected}
                onClose={() => { setPicker(null); setPanel(null); }} />
            ) : selected ? (
              <ConfigPanel
                key={selected.id}
                id={selected.id} data={selected.data} nodeType={types.get(selected.data.nodeType)}
                issues={issueMap.get(selected.id) ?? []} upstream={upstream} readOnly={locked}
                onClose={() => setPanel(null)}
                onRename={(name) => setNodes((items) => patchNode(items, selected.id, { label: name }))}
                onConfig={(config) => setNodes((items) => setNodeConfig(items, selected.id, config))}
                onRetry={(retry) => setNodes((items) => setNodeRetry(items, selected.id, retry))}
                onDelete={deleteSelected}
              />
            ) : null}
          </aside>
        )}
      </div>

      <div className="flex h-8 shrink-0 items-center justify-between border-t border-border bg-surface px-4 text-[11px] text-muted-foreground">
        <span className="font-mono">{nodes.length} steps · {edges.length} connections</span>
        <span role="status" aria-live="polite" className={running ? "text-warning" : dry.state === "success" ? "text-success" : dry.state === "failure" ? "text-destructive" : ""}>
          {dry.state === "idle" ? `Draft revision ${actions.meta.revision}` : running ? `Dry run · ${dry.completed}/${nodes.length} steps` : dry.state === "success" ? "Dry run succeeded" : "Dry run failed"}
        </span>
      </div>

      <PublishDialog
        open={publishOpen} onOpenChange={setPublishOpen} nextVersion={(production ?? 0) + 1}
        stagingVerified={actions.meta.staging_verified} hasUnsavedChanges={actions.dirty}
        knownProblems={actions.issues.length} busy={actions.publishing}
        onConfirm={async () => { await actions.publish(); setPublishOpen(false); /* failures are reported on the canvas or in the conflict dialog */ }}
      />
      <ConflictDialog open={actions.conflict} busy={actions.resolving} onCancel={actions.dismissConflict} onOverwrite={() => void actions.overwrite()} onReload={onReload} />
    </div>
  );
}
