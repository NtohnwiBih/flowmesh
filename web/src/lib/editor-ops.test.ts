import { describe, expect, it } from "vitest";
import {
  ancestors, canAddNode, canConnect, executionOrder, graphHasCycle, makeEdge, nodeFromType, patchNode,
  removeNodes, setNodeConfig, setNodeRetry, stepPosition, typesById,
} from "./editor-ops";
import type { FlowEdge, FlowNode } from "./definition";
import { catalog, typeById } from "./test-helpers";

const types = typesById(catalog);
const http = typeById("http");
const hook = typeById("webhook");

function build(...specs: [id: string, type: string][]): FlowNode[] {
  return specs.map(([id, type], i) => ({
    id, type: "flowNode", position: { x: i * 300, y: 100 },
    data: { label: id, description: "", kind: type, icon: type, nodeType: type },
  }));
}
const e = (a: string, b: string): FlowEdge => ({ id: `${a}-${b}`, source: a, target: b });

describe("adding nodes", () => {
  it("refuses unavailable types with the server's reason", () => {
    const v = canAddNode([], typeById("condition"), types);
    expect(v).toEqual({ ok: false, reason: expect.stringMatching(/coming soon/) });
  });
  it("allows one trigger, not two", () => {
    expect(canAddNode([], hook, types).ok).toBe(true);
    const v = canAddNode(build(["h", "webhook"]), hook, types);
    expect(v).toEqual({ ok: false, reason: "A workflow can have only one trigger." });
  });
  it("builds a node from the catalog with a readable, unique id", () => {
    const first = nodeFromType(http, [], { x: 10, y: 20 });
    expect(first.id).toBe("http_request");
    expect(first.data).toMatchObject({ label: "HTTP Request", kind: "HTTP Request", nodeType: "http", icon: "http" });
    const second = nodeFromType(http, [first], { x: 10, y: 20 });
    expect(second.id).toBe("http_request_2");
    expect(second.position).not.toEqual(first.position); // not dropped on top of it
  });
});

describe("editing nodes", () => {
  const nodes = build(["a", "http"], ["b", "http"]);
  it("patches only the target node, immutably", () => {
    const out = patchNode(nodes, "a", { label: "Renamed" });
    expect(out[0].data.label).toBe("Renamed");
    expect(out[1]).toBe(nodes[1]);
    expect(nodes[0].data.label).toBe("a");
  });
  it("updates the card subtitle when the config changes", () => {
    const out = setNodeConfig(nodes, "a", { method: "POST", url: "https://x/y" });
    expect(out[0].data.description).toBe("POST https://x/y");
    expect(out[0].data.config).toEqual({ method: "POST", url: "https://x/y" });
    const cleared = setNodeConfig(out, "a", undefined);
    expect(cleared[0].data.config).toBeUndefined();
    expect(cleared[0].data.description).toBe("Configure this step");
  });
  it("sets and clears the retry policy", () => {
    const on = setNodeRetry(nodes, "a", { max_attempts: 3, backoff_seconds: 5 });
    expect(on[0].data.retry).toEqual({ max_attempts: 3, backoff_seconds: 5 });
    expect(setNodeRetry(on, "a", undefined)[0].data.retry).toBeUndefined();
  });
  it("removes a node and every edge touching it", () => {
    const three = build(["a", "http"], ["b", "http"], ["c", "http"]);
    const out = removeNodes(three, [e("a", "b"), e("b", "c"), e("a", "c")], ["b"]);
    expect(out.nodes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(out.edges.map((x) => x.id)).toEqual(["a-c"]);
  });
});

describe("connecting", () => {
  const nodes = build(["h", "webhook"], ["a", "http"], ["b", "http"]);
  const edges = [e("h", "a"), e("a", "b")];
  it("allows a valid connection", () => expect(canConnect(nodes, [e("h", "a")], types, "a", "b")).toEqual({ ok: true }));
  it.each([
    ["itself", "a", "a", /itself/],
    ["a duplicate", "h", "a", /already connected/],
    ["into a trigger", "a", "h", /trigger/],
    ["a loop", "b", "a", /loop/],
    ["an unknown step", "a", "zzz", /Unknown/],
  ])("rejects %s", (_name, s, t, why) => {
    const v = canConnect(nodes, edges, types, s, t);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(why);
  });
  it("makes edges with unique ids and the default sides", () => {
    const x = makeEdge("a", "b"), y = makeEdge("a", "b");
    expect(x.id).not.toBe(y.id);
    expect([x.sourceHandle, x.targetHandle]).toEqual(["right", "left"]);
  });
  it("detects a loop drawn on the canvas", () => {
    expect(graphHasCycle(nodes, edges)).toBe(false);
    expect(graphHasCycle(nodes, [...edges, e("b", "a")])).toBe(true);
  });
});

describe("helpers", () => {
  it("lists upstream steps nearest first, without repeats", () => {
    const edges = [e("a", "b"), e("b", "c"), e("a", "c"), e("x", "a")];
    expect(ancestors(edges, "c")).toEqual(["b", "a", "x"]);
    expect(ancestors(edges, "x")).toEqual([]);
  });
  it("terminates on a cycle", () => expect(ancestors([e("a", "b"), e("b", "a")], "a")).toEqual(["b"]));
  it("places a connected step one slot over on the chosen side", () => {
    const [a] = build(["a", "http"]);
    expect(stepPosition(a, "right")).toEqual({ x: 290, y: 100 });
    expect(stepPosition(a, "bottom")).toEqual({ x: 0, y: 240 });
  });
});

describe("executionOrder", () => {
  it("puts every step after the steps it depends on", () => {
    const nodes = build(["d", "http"], ["b", "http"], ["a", "http"], ["c", "http"]); // deliberately shuffled
    const order = executionOrder(nodes, [e("a", "b"), e("a", "c"), e("b", "d"), e("c", "d")])!;
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("d")).toBe(3);
    expect(order).toHaveLength(4);
  });
  it("returns null for a loop, and handles an empty graph", () => {
    expect(executionOrder(build(["a", "http"], ["b", "http"]), [e("a", "b"), e("b", "a")])).toBeNull();
    expect(executionOrder([], [])).toEqual([]);
  });
});
