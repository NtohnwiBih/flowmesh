import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  autoLayout, fromFlow, hasCycle, normalize, toFlow, withLayout, wouldCreateCycle,
  type Definition,
} from "./definition";

// The same files are validated by the Go and Python test suites.
const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../schemas/fixtures");
function load(kind: "valid" | "invalid"): [string, Definition][] {
  const dir = path.join(FIXTURES, kind);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`no fixtures in ${dir}`);
  return files.map((f) => [f, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Definition]);
}
const roundTrip = (d: Definition) => {
  const { nodes, edges } = toFlow(d);
  return fromFlow(nodes, edges);
};

describe("round trip through the canvas", () => {
  it.each(load("valid"))("%s survives unchanged (up to layout and the canonical form)", (_f, def) => {
    expect(roundTrip(def)).toEqual(normalize(withLayout(def)));
  });

  it.each(load("valid"))("%s: converting twice changes nothing (a fixed point)", (_f, def) => {
    const once = roundTrip(def);
    expect(roundTrip(once)).toEqual(once);
  });

  it.each(load("valid"))("%s keeps every id, type, config, retry and edge", (_f, def) => {
    const out = roundTrip(def);
    expect(out.nodes.map((n) => [n.id, n.type, n.config, n.retry])).toEqual(
      def.nodes.map((n) => [n.id, n.type, n.config, n.retry]),
    );
    expect(out.edges.map((e) => [e.from, e.to, e.label])).toEqual(def.edges.map((e) => [e.from, e.to, e.label]));
  });

  it("is exactly lossless for an already canonical definition", () => {
    const def: Definition = {
      schema_version: 1,
      nodes: [
        { id: "hook", type: "webhook", name: "Order webhook", ui: { x: 50, y: 120 } },
        { id: "fetch", type: "http", name: "Fetch", config: { url: "http://x/{{ nodes.hook.body.id }}", method: "GET" },
          retry: { max_attempts: 3, backoff_seconds: 5 }, ui: { x: 340, y: 120 } },
      ],
      edges: [{ from: "hook", to: "fetch", label: "ok", ui: { source_handle: "bottom", target_handle: "top" } }],
    };
    expect(roundTrip(def)).toEqual(def);
  });

  it("drops runtime-only data such as node status", () => {
    const { nodes, edges } = toFlow(load("valid")[0][1]);
    nodes[0].data.status = "running";
    expect(JSON.stringify(fromFlow(nodes, edges))).not.toContain("running");
  });

  it("rounds positions to whole pixels", () => {
    const { nodes, edges } = toFlow(load("valid")[0][1]);
    nodes[0].position = { x: 10.6, y: 20.4 };
    expect(fromFlow(nodes, edges).nodes[0].ui).toEqual({ x: 11, y: 20 });
  });

  it("renaming a node changes its name but never its id", () => {
    const { nodes, edges } = toFlow(load("valid")[0][1]);
    const id = nodes[0].id;
    nodes[0].data.label = "Brand new name";
    const n = fromFlow(nodes, edges).nodes[0];
    expect([n.id, n.name]).toEqual([id, "Brand new name"]);
  });
});

describe("toFlow", () => {
  const def: Definition = {
    schema_version: 1,
    nodes: [
      { id: "a", type: "webhook", name: "Order webhook", ui: { x: 5, y: 6 } },
      { id: "b", type: "http", config: { method: "POST", url: "https://x/orders" } },
      { id: "c", type: "mystery" },
    ],
    edges: [{ from: "a", to: "b" }, { from: "a", to: "b" }, { from: "b", to: "c", ui: { source_handle: "bottom", target_handle: "bogus" } }],
  };
  const { nodes, edges } = toFlow(def);

  it("uses the name, falling back to the id", () => {
    expect(nodes.map((n) => n.data.label)).toEqual(["Order webhook", "b", "c"]);
  });
  it("derives kind, icon and subtitle from the type and config", () => {
    expect(nodes[1].data).toMatchObject({ kind: "HTTP Request", icon: "http", description: "POST https://x/orders" });
    expect(nodes[2].data).toMatchObject({ kind: "mystery", icon: "action", description: "Configure this step" });
  });
  it("keeps saved positions and lays out the rest", () => {
    expect(nodes[0].position).toEqual({ x: 5, y: 6 });
    expect(nodes[1].position.x).toBeGreaterThan(nodes[0].position.x);
  });
  it("gives parallel edges distinct ids", () => {
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
  });
  it("defaults edge sides, and ignores invalid ones", () => {
    expect([edges[0].sourceHandle, edges[0].targetHandle]).toEqual(["right", "left"]);
    expect([edges[2].sourceHandle, edges[2].targetHandle]).toEqual(["bottom", "left"]);
  });
});

describe("autoLayout", () => {
  const n = (id: string) => ({ id, type: "x" });
  it("puts a chain in increasing columns", () => {
    const p = autoLayout({ schema_version: 1, nodes: [n("a"), n("b"), n("c")], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] });
    expect(p.a.x < p.b.x && p.b.x < p.c.x).toBe(true);
  });
  it("stacks parallel branches in one column and puts the join after them", () => {
    const [, diamond] = load("valid").find(([f]) => f === "diamond.json")!;
    const p = autoLayout(diamond);
    expect(p.b.x).toBe(p.c.x);
    expect(p.b.y).not.toBe(p.c.y);
    expect(p.d.x).toBeGreaterThan(p.b.x);
  });
  it.each(load("invalid").filter(([f]) => ["cycle.json", "self_loop.json"].includes(f)))(
    "terminates on %s and still places every node",
    (_f, def) => {
      const p = autoLayout(def);
      expect(Object.keys(p).sort()).toEqual(def.nodes.map((x) => x.id).sort());
    },
  );
  it("is deterministic", () => {
    const [, d] = load("valid")[1];
    expect(autoLayout(d)).toEqual(autoLayout(d));
  });
});

describe("half-built drafts", () => {
  // Drafts are saved leniently, so the editor must be able to open broken ones.
  it.each(load("invalid"))("toFlow does not throw on %s", (_f, def) => {
    expect(() => toFlow(def)).not.toThrow();
  });
});

describe("cycle checks", () => {
  const ids = ["a", "b", "c"];
  const l = (source: string, target: string) => ({ source, target });
  it("hasCycle", () => {
    expect(hasCycle(ids, [l("a", "b"), l("b", "c")])).toBe(false);
    expect(hasCycle(ids, [l("a", "b"), l("b", "c"), l("c", "a")])).toBe(true);
    expect(hasCycle(["a"], [l("a", "a")])).toBe(true);
  });
  it("wouldCreateCycle", () => {
    const links = [l("a", "b"), l("b", "c")];
    expect(wouldCreateCycle(links, "c", "a")).toBe(true); // closes the loop
    expect(wouldCreateCycle(links, "a", "c")).toBe(false); // a harmless shortcut
    expect(wouldCreateCycle(links, "b", "b")).toBe(true);
  });
});
