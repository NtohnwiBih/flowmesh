import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  Handle,
  MiniMap,
  Position,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  Blocks,
  Bot,
  Braces,
  Check,
  ChevronDown,
  CirclePlay,
  Clock3,
  Code2,
  GitBranch,
  Globe2,
  GripVertical,
  LockKeyhole,
  LoaderCircle,
  MessageSquareText,
  MoreHorizontal,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Webhook,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { integrations, integrationCategories } from "@/lib/integrations";
import { WorkflowLogs, type WorkflowLog } from "@/components/workflow-logs";
import { IntegrationLogo } from "./integrations/integration-logo";

type FlowNodeData = {
  label: string;
  description: string;
  kind: string;
  status?: "success" | "idle" | "running" | "failure";
  icon: string;
  nodeType?: string; // the definition's node type; set for nodes loaded from a draft
  config?: Record<string, unknown>;
  retry?: { max_attempts: number; backoff_seconds?: number };
  [key: string]: unknown;
};

type FlowNode = Node<FlowNodeData>;

const iconMap = { webhook: Webhook, http: Globe2, ai: Sparkles, condition: GitBranch, action: Zap, code: Code2 };

const initialNodes: FlowNode[] = [
  { id: "1", type: "flowNode", position: { x: 50, y: 230 }, data: { label: "Order webhook", description: "POST /orders/new", kind: "Trigger", icon: "webhook", status: "success" } },
  { id: "2", type: "flowNode", position: { x: 340, y: 230 }, data: { label: "Fetch customer", description: "GET /v2/customers/:id", kind: "HTTP Request", icon: "http", status: "success" } },
  { id: "3", type: "flowNode", position: { x: 630, y: 230 }, data: { label: "Classify intent", description: "flowmesh/classifier-v2", kind: "AI Classifier", icon: "ai", status: "success" } },
  { id: "4", type: "flowNode", position: { x: 920, y: 230 }, data: { label: "High priority?", description: "confidence > 0.85", kind: "Condition", icon: "condition", status: "idle" } },
  { id: "5", type: "flowNode", position: { x: 1210, y: 120 }, data: { label: "Create incident", description: "POST /incidents", kind: "Action", icon: "action", status: "idle" } },
  { id: "6", type: "flowNode", position: { x: 1210, y: 350 }, data: { label: "Queue for review", description: "support-review", kind: "Action", icon: "action", status: "idle" } },
];

const initialEdges: Edge[] = [
  { id: "e1-2", source: "1", sourceHandle: "right", target: "2", targetHandle: "left", animated: true },
  { id: "e2-3", source: "2", sourceHandle: "right", target: "3", targetHandle: "left", animated: true },
  { id: "e3-4", source: "3", sourceHandle: "right", target: "4", targetHandle: "left", animated: true },
  { id: "e4-5", source: "4", sourceHandle: "right", target: "5", targetHandle: "left", label: "true" },
  { id: "e4-6", source: "4", sourceHandle: "right", target: "6", targetHandle: "left", label: "false" },
];

const library = [
  { kind: "Triggers", items: [{ label: "Webhook", icon: Webhook, key: "webhook" }, { label: "Schedule", icon: Clock3, key: "schedule" }] },
  { kind: "Core", items: [{ label: "HTTP Request", icon: Globe2, key: "http" }, { label: "Condition", icon: GitBranch, key: "condition" }, { label: "Code", icon: Code2, key: "code" }] },
  { kind: "AI", items: [{ label: "AI Classifier", icon: Sparkles, key: "ai" }, { label: "Generate text", icon: MessageSquareText, key: "generate" }] },
];

type Side = "top" | "right" | "bottom" | "left";
const sides: { id: Side; pos: Position }[] = [
  { id: "top", pos: Position.Top }, { id: "right", pos: Position.Right }, { id: "bottom", pos: Position.Bottom }, { id: "left", pos: Position.Left },
];
const opposite: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
const EditorContext = createContext<{ edges: Edge[]; openPicker: (nodeId: string, side: Side) => void }>({ edges: [], openPicker: () => {} });

function FlowNodeCard({ id, data, selected }: NodeProps<FlowNode>) {
  const Icon = iconMap[data.icon as keyof typeof iconMap] ?? Workflow;
  const app = integrations.find((i) => i.key === data.icon);
  const { edges, openPicker } = useContext(EditorContext);
  const used = (side: Side) => edges.some((e) => (e.source === id && e.sourceHandle === side) || (e.target === id && e.targetHandle === side));
  return (
    <div className={cn("flow-node group relative", selected && "flow-node-selected", data.status && `flow-node-${data.status}`)} data-status={data.status ?? "idle"}>
      {sides.map((s) => <Handle key={s.id} id={s.id} type="source" position={s.pos} />)}
      {sides.filter((s) => !used(s.id)).map((s) => (
        <div key={`add-${s.id}`} className={cn("node-add-stub nodrag nopan", `node-add-${s.id}`)}>
          <span className="node-add-line" />
          <Button variant="outline" size="icon" type="button" title="Add connected step" aria-label={`Add step ${s.id}`} onClick={(e) => { e.stopPropagation(); openPicker(id, s.id); }} className="node-add-btn"><Plus /></Button>
        </div>
      ))}
      <div className="flow-node-icon">{app ? <IntegrationLogo id={app.key} name={app.name} className="size-5" /> : <Icon />}</div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="truncate text-xs font-semibold text-foreground">{data.label}</span>
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

const nodeTypes = { flowNode: FlowNodeCard };

export function WorkflowEditor({ environment = "Production", pendingIntegration, onPendingHandled, loaded, title = "Support intake routing", versionLabel = "v17" }: { environment?: string; pendingIntegration?: string | null; onPendingHandled?: () => void; loaded?: { nodes: FlowNode[]; edges: Edge[] }; title?: string; versionLabel?: string } = {}) {
  // `loaded` is a draft from the API; without it the editor shows the built-in demo graph.
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>((loaded?.nodes ?? initialNodes).map((node) => ({ ...node, data: { ...node.data, status: "idle" } })));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(loaded?.edges ?? initialEdges);
  const [selectedId, setSelectedId] = useState(loaded ? (loaded.nodes[0]?.id ?? "") : "3");
  const [panelOpen, setPanelOpen] = useState(false);
  const [saved, setSaved] = useState(true);
  const [query, setQuery] = useState("");
  const [appsOpen, setAppsOpen] = useState(false);
  const [appQuery, setAppQuery] = useState("");
  const [picker, setPicker] = useState<{ nodeId: string; side: Side } | null>(null);
  const [pickerTab, setPickerTab] = useState<"nodes" | "integrations">("nodes");
  const [pickerQuery, setPickerQuery] = useState("");
  const [flow, setFlow] = useState<ReactFlowInstance<FlowNode, Edge> | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const handledRef = useRef<string | null>(null);
  const runTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [execution, setExecution] = useState<"idle" | "running" | "success" | "failure">("idle");
  const [completedSteps, setCompletedSteps] = useState(0);
  const [logs, setLogs] = useState<WorkflowLog[]>([]);
  const logId = useRef(0);
  const appendLog = (level: WorkflowLog["level"], message: string) => {
    const entry: WorkflowLog = { id: ++logId.current, time: new Date().toLocaleTimeString("en-GB", { hour12: false }), level, message };
    setLogs((items) => [...items, entry]);
  };
  useEffect(() => () => { if (runTimer.current) clearTimeout(runTimer.current); }, []);
  const selected = nodes.find((node) => node.id === selectedId);

  const onConnect = useCallback((connection: Connection) => setEdges((items) => addEdge({ ...connection, animated: true }, items)), [setEdges]);

  const addNode = useCallback((nodeType: string, position: { x: number; y: number }) => {
    const app = integrations.find((i) => i.key === nodeType);
    const definition = library.flatMap((group) => group.items).find((item) => item.key === nodeType);
    if (!app && !definition) return;
    const newNode: FlowNode = {
      id: crypto.randomUUID(),
      type: "flowNode",
      position,
      data: app
        ? { label: `${app.name}: ${app.action}`, description: "Configure this step", kind: app.name, icon: app.key }
        : { label: definition?.label ?? nodeType, description: "Configure this step", kind: definition?.label ?? nodeType, icon: nodeType === "schedule" ? "action" : nodeType === "generate" ? "ai" : nodeType },
    };
    setNodes((items) => [...items, newNode]);
    setSelectedId(newNode.id);
    setPanelOpen(true);
    setSaved(false);
    return newNode;
  }, [setNodes]);

  useEffect(() => {
    if (!pendingIntegration || handledRef.current === pendingIntegration) return;
    handledRef.current = pendingIntegration;
    const node = addNode(pendingIntegration, { x: 1500, y: 230 });
    if (node) {
      setEdges((items) => addEdge({ id: `e5-${node.id}`, source: "5", sourceHandle: "right", target: node.id, targetHandle: "left", animated: true }, items));
      toast.success(`${node.data.kind} added to workflow`, { description: "Connected after “Create incident”." });
    }
    onPendingHandled?.();
    setTimeout(() => { handledRef.current = null; }, 0);
  }, [pendingIntegration, addNode, setEdges, onPendingHandled]);

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    const nodeType = event.dataTransfer.getData("application/flowmesh");
    if (!nodeType || !flow) return;
    addNode(nodeType, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [flow, addNode]);

  const openPicker = useCallback((nodeId: string, side: Side) => { setPicker({ nodeId, side }); setPickerQuery(""); setPickerTab("nodes"); setAppsOpen(false); setPanelOpen(false); }, []);
  const ctx = useMemo(() => ({ edges, openPicker }), [edges, openPicker]);

  const addFromPicker = (key: string) => {
    if (!picker) return;
    const from = nodes.find((n) => n.id === picker.nodeId);
    if (!from) return;
    const d = ({ right: [290, 0], left: [-290, 0], top: [0, -140], bottom: [0, 140] } as Record<Side, [number, number]>)[picker.side];
    const node = addNode(key, { x: from.position.x + d[0], y: from.position.y + d[1] });
    if (!node) return;
    setEdges((items) => addEdge({ id: `e-${from.id}-${node.id}`, source: from.id, sourceHandle: picker.side, target: node.id, targetHandle: opposite[picker.side], animated: true }, items));
    setPicker(null);
    toast.success(`${node.data.kind} connected`, { description: `Linked to “${from.data.label}”.` });
  };

  const updateSelected = (field: "label" | "description", value: string) => {
    setNodes((items) => items.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, [field]: value } } : node));
    setSaved(false);
  };

  const runWorkflow = (simulateFailure = false) => {
    if (execution === "running" || nodes.length === 0) return;
    // Resolve dependencies rather than relying on canvas position or insertion order.
    const remaining = new Set(nodes.map((node) => node.id));
    const order: string[] = [];
    while (remaining.size) {
      const ready = nodes.filter((node) => remaining.has(node.id) && !edges.some((edge) => edge.target === node.id && remaining.has(edge.source)));
      if (!ready.length) { appendLog("error", "Execution blocked: workflow contains a cycle."); toast.error("Cannot run a workflow with a cycle"); return; }
      ready.forEach((node) => { remaining.delete(node.id); order.push(node.id); });
    }
    const failedId = simulateFailure ? order[order.length - 1] : undefined;
    setLogs([]);
    appendLog("info", `Simulated run started · ${environment} · ${order.length} steps`);
    setExecution("running");
    setCompletedSteps(0);
    setNodes((items) => items.map((node) => ({ ...node, data: { ...node.data, status: "idle" } })));
    setEdges((items) => items.map((edge) => ({ ...edge, className: "", animated: false })));
    toast.info("Simulated execution started");
    const advance = (index: number) => {
      const id = order[index];
      if (!id) {
        setExecution(simulateFailure ? "failure" : "success");
        runTimer.current = null;
        appendLog(simulateFailure ? "error" : "success", simulateFailure ? "Execution failed: a step returned a simulated error." : `Execution succeeded · ${order.length} steps completed.`);
        if (simulateFailure) toast.error("Simulated execution failed", { description: "A step returned an error." });
        else toast.success("Simulated execution succeeded");
        return;
      }
      const label = nodes.find((node) => node.id === id)?.data.label ?? id;
      appendLog("info", `[${index + 1}/${order.length}] ${label} · started`);
      setNodes((items) => items.map((node) => node.id === id ? { ...node, data: { ...node.data, status: "running" } } : node));
      setEdges((items) => items.map((edge) => edge.target === id ? { ...edge, className: "flow-edge-running", animated: true } : edge));
      runTimer.current = setTimeout(() => {
        const status = id === failedId ? "failure" : "success";
        appendLog(status === "failure" ? "error" : "success", `${label} · ${status === "failure" ? "failed: simulated step error" : "completed"} · 850ms`);
        setNodes((items) => items.map((node) => node.id === id ? { ...node, data: { ...node.data, status } } : node));
        setEdges((items) => items.map((edge) => edge.target === id ? { ...edge, className: `flow-edge-${status}`, animated: false } : edge));
        setCompletedSteps(index + 1);
        runTimer.current = setTimeout(() => advance(index + 1), 250);
      }, 850);
    };
    advance(0);
  };

  const action = (name: string) => {
    if (name === "Saved") setSaved(true);
    toast.success(name, { description: name === "Published" ? "Version 18 is now live." : "Workflow configuration looks healthy." });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-workspace">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" title="Workflow menu"><Workflow className="size-4" /></Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><h1 className="truncate text-sm font-semibold">{title}</h1><span className="status-live">Active</span></div>
            <p className="text-[11px] text-muted-foreground">{environment} · {versionLabel} {saved ? "· All changes saved" : "· Unsaved changes"}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => action("Workflow validated")}><ShieldCheck /> <span className="hidden sm:inline">Validate</span></Button>
          <Button variant="outline" size="sm" onClick={() => action("Saved")}><Save /> <span className="hidden sm:inline">Save</span></Button>
          <Button variant="outline" size="sm" onClick={() => action("Published")}><Radio /> <span className="hidden lg:inline">Publish</span></Button>
           <div className="flex items-center gap-0.5">
             <Button size="sm" disabled={execution === "running"} onClick={() => runWorkflow()}>{execution === "running" ? <LoaderCircle className="animate-spin" /> : <Play className="fill-current" />} {execution === "running" ? "Running" : "Run"}</Button>
             <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" className="size-8" disabled={execution === "running"} aria-label="Execution options" title="Execution options"><ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => runWorkflow()}>Simulate successful run</DropdownMenuItem><DropdownMenuItem onClick={() => runWorkflow(true)}>Simulate failed run</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
           </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-border bg-surface p-3 md:block">
          <div className="relative mb-4"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input className="h-8 pl-8 text-xs" placeholder="Search nodes & apps" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          {library.map((group) => ({ ...group, items: group.items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase())) })).filter((g) => g.items.length).map((group) => (
            <div className="mb-5" key={group.kind}>
              <div className="mb-2 flex items-center justify-between px-1"><span className="text-[10px] font-semibold uppercase text-muted-foreground">{group.kind}</span><ChevronDown className="size-3 text-muted-foreground" /></div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <div key={item.key} draggable onDragStart={(event) => { event.dataTransfer.setData("application/flowmesh", item.key); event.dataTransfer.effectAllowed = "move"; }} className="node-library-item">
                    <item.icon className="size-4 text-primary" /><span className="flex-1">{item.label}</span><GripVertical className="size-3.5 text-muted-foreground/60" />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="mb-5">
            <div className="mb-2 px-1 text-[10px] font-semibold uppercase text-muted-foreground">Integrations</div>
            <button onClick={() => { setAppsOpen(true); setPanelOpen(false); setPicker(null); }} className={cn("node-library-item w-full text-left", appsOpen && "border-primary")}>
              <Blocks className="size-4 text-primary" /><span className="flex-1">Integrations</span><span className="font-mono text-[10px] text-muted-foreground">{integrations.length}</span>
            </button>
          </div>
          <div className="mt-6 border-t border-border pt-4"><Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground"><Plus /> Browse 38 nodes</Button></div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={wrapper} className="relative min-h-0 min-w-0 flex-1" onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}>
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-md border border-border bg-surface/90 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur"><LockKeyhole className="size-3" /> {environment} environment</div>
          <EditorContext.Provider value={ctx}>
          <ReactFlow<FlowNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={setFlow}
             onNodesChange={(changes) => { if (execution !== "running") onNodesChange(changes); }}
             onEdgesChange={(changes) => { if (execution !== "running") onEdgesChange(changes); }}
             nodesDraggable={execution !== "running"}
             nodesConnectable={execution !== "running"}
             deleteKeyCode={execution === "running" ? null : "Backspace"}
            onConnect={onConnect}
            connectionMode={ConnectionMode.Loose}
            onNodeClick={(_, node) => { setSelectedId(node.id); setPanelOpen(true); setAppsOpen(false); setPicker(null); }}
            fitView
            fitViewOptions={{ padding: 0.16 }}
            minZoom={0.35}
            maxZoom={1.5}
            defaultEdgeOptions={{ type: "smoothstep" }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap position="bottom-right" pannable zoomable className="flow-minimap" />
          </ReactFlow>
          </EditorContext.Provider>
        </div>
        <WorkflowLogs logs={logs} running={execution === "running"} onClear={() => setLogs([])} />
        </div>

        {picker && (() => { const from = nodes.find((n) => n.id === picker.nodeId); const q = pickerQuery.toLowerCase();
          const groups = (pickerTab === "nodes"
            ? library.map((g) => ({ name: g.kind, items: g.items.filter((i) => i.label.toLowerCase().includes(q)).map((i) => ({ key: i.key, title: i.label, sub: g.kind, icon: <i.icon className="size-4 text-primary" /> })) }))
            : integrationCategories.map((c) => ({ name: c, items: integrations.filter((i) => i.category === c && i.name.toLowerCase().includes(q)).map((i) => ({ key: i.key, title: i.name, sub: i.action, icon: <IntegrationLogo id={i.key} name={i.name} className="size-4" /> })) }))).filter((g) => g.items.length);
          return (
          <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(360px,92vw)] flex-col border-l border-border bg-surface shadow-panel">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <div className="min-w-0"><p className="text-xs font-semibold">Add connected step</p><p className="truncate text-[10px] text-muted-foreground">From “{from?.data.label}” · {picker.side} connector</p></div>
              <Button variant="ghost" size="icon" onClick={() => setPicker(null)} title="Close panel"><X /></Button>
            </div>
            <div className="space-y-3 border-b border-border p-3">
              <Tabs value={pickerTab} onValueChange={(value) => { if (value === "nodes" || value === "integrations") { setPickerTab(value); setPickerQuery(""); } }}>
                <TabsList className="grid w-full grid-cols-2" aria-label="Connected step type">
                  <TabsTrigger value="nodes"><Workflow className="mr-1.5 size-3.5" />Nodes</TabsTrigger>
                  <TabsTrigger value="integrations"><Blocks className="mr-1.5 size-3.5" />Integrations</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="relative"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input autoFocus className="h-8 pl-8 text-xs" placeholder={pickerTab === "nodes" ? "Search nodes" : "Search apps"} value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} /></div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {groups.length === 0 && <p className="py-10 text-center text-xs text-muted-foreground">{pickerTab === "nodes" ? "No matching nodes" : "No matching apps"}</p>}
              {groups.map((g) => (
                <div className="mb-5" key={g.name}>
                  <div className="mb-2 px-1 text-[10px] font-semibold uppercase text-muted-foreground">{g.name}</div>
                  <div className="space-y-1">{g.items.map((it) => (
                    <Button variant="ghost" key={it.key} onClick={() => addFromPicker(it.key)} className="node-library-item h-auto w-full text-left">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card">{it.icon}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{it.title}</span><span className="block truncate text-[10px] text-muted-foreground">{it.sub}</span></span>
                      <Plus className="size-3.5 text-muted-foreground" />
                    </Button>))}</div>
                </div>))}
            </div>
          </aside>); })()}
        {appsOpen && !picker && (
          <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(360px,92vw)] flex-col border-l border-border bg-surface shadow-panel">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <div><p className="text-xs font-semibold">Integrations</p><p className="text-[10px] text-muted-foreground">Click or drag an app onto the canvas</p></div>
              <Button variant="ghost" size="icon" onClick={() => setAppsOpen(false)} title="Close panel"><X /></Button>
            </div>
            <div className="border-b border-border p-3"><div className="relative"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input className="h-8 pl-8 text-xs" placeholder="Search apps" value={appQuery} onChange={(e) => setAppQuery(e.target.value)} /></div></div>
            <div className="flex-1 overflow-y-auto p-3">
              {integrationCategories.map((cat) => { const apps = integrations.filter((i) => i.category === cat && i.name.toLowerCase().includes(appQuery.toLowerCase())); if (!apps.length) return null; return (
                <div className="mb-5" key={cat}>
                  <div className="mb-2 px-1 text-[10px] font-semibold uppercase text-muted-foreground">{cat}</div>
                  <div className="space-y-1">{apps.map((app) => (
                    <button key={app.key} draggable onDragStart={(event) => { event.dataTransfer.setData("application/flowmesh", app.key); event.dataTransfer.effectAllowed = "move"; }} onClick={() => { const n = addNode(app.key, { x: 1500, y: 120 + nodes.length * 30 }); setAppsOpen(true); setPanelOpen(false); if (n) toast.success(`${app.name} added`, { description: app.action }); }} className="node-library-item w-full text-left">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                        <IntegrationLogo id={app.key} name={app.name} className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{app.name}</span><span className="block truncate text-[10px] text-muted-foreground">{app.action}</span></span>
                      <Plus className="size-3.5 text-muted-foreground" />
                    </button>))}</div>
                </div>); })}
            </div>
          </aside>
        )}
        {panelOpen && selected && !appsOpen && !picker && (
          <aside className="absolute inset-y-0 right-0 z-20 w-[min(340px,90vw)] overflow-y-auto border-l border-border bg-surface shadow-panel">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <div><p className="text-xs font-semibold">Configure node</p><p className="text-[10px] text-muted-foreground">{selected.data.kind}</p></div>
              <Button variant="ghost" size="icon" onClick={() => setPanelOpen(false)} title="Close panel"><X /></Button>
            </div>
            <div className="space-y-5 p-4">
              <div className="config-section">
                <label className="config-label">Display name</label>
                <Input value={selected.data.label} onChange={(e) => updateSelected("label", e.target.value)} />
              </div>
              <div className="config-section">
                <label className="config-label">Model</label>
                <button className="config-select"><span className="flex items-center gap-2"><Bot className="size-4 text-primary" /> FM Classifier v2</span><ChevronDown className="size-4" /></button>
              </div>
              <div className="config-section">
                <div className="mb-2 flex items-center justify-between"><label className="config-label mb-0">Input</label><span className="font-mono text-[10px] text-primary">Expression</span></div>
                <div className="code-field"><Braces className="size-4 text-primary" /><input value={selected.data.description} onChange={(e) => updateSelected("description", e.target.value)} aria-label="Node input expression" /></div>
              </div>
              <div className="config-section">
                <label className="config-label">Categories</label>
                <div className="space-y-2">{["Urgent", "Billing", "Product", "Other"].map((item, index) => <div className="category-row" key={item}><span className="flex items-center gap-2"><span className={cn("category-dot", `category-dot-${index + 1}`)} />{item}</span><MoreHorizontal className="size-4 text-muted-foreground" /></div>)}</div>
                <Button variant="ghost" size="sm" className="mt-2 w-full border border-dashed border-border text-muted-foreground"><Plus /> Add category</Button>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-4"><div><p className="text-xs font-medium">Retry on failure</p><p className="text-[10px] text-muted-foreground">Up to 3 attempts</p></div><Switch defaultChecked /></div>
            </div>
            <div className="sticky bottom-0 flex gap-2 border-t border-border bg-surface p-4"><Button className="flex-1" onClick={() => { setSaved(true); toast.success("Node configuration saved"); }}>Apply changes</Button><Button variant="outline" size="icon" title="Test this node" onClick={() => toast.success("Node test passed", { description: "Completed in 284ms" })}><CirclePlay /></Button></div>
          </aside>
        )}
      </div>
      <div className="flex h-8 shrink-0 items-center justify-between border-t border-border bg-surface px-3 font-mono text-[10px] text-muted-foreground">
        <div className="flex items-center gap-4"><span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-success" />Worker eu-west-3</span><span>{nodes.length} nodes</span><span>{edges.length} connections</span></div>
         <div className="flex items-center gap-3" role="status" aria-live="polite"><span className={cn(execution === "success" && "text-success", execution === "failure" && "text-destructive", execution === "running" && "text-warning")}>{execution === "idle" ? "Last run 2m ago" : execution === "running" ? `Running · ${completedSteps}/${nodes.length} steps` : execution === "success" ? `Succeeded · ${completedSteps} steps` : `Failed · ${completedSteps} steps`}</span><RefreshCw className="size-3" /></div>
      </div>
    </div>
  );
}
