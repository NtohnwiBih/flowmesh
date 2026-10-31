import { describe, expect, it } from "vitest";
import { describeProblems, fieldMessage, issuesByNode, nodeLevel, unattached } from "./issues";
import type { Issue } from "./api/types";

const issues: Issue[] = [
  { code: "invalid_config", message: "'url' is a required property", node_id: "a", path: "config" },
  { code: "invalid_config", message: "'FETCH' is not one of the methods", node_id: "a", path: "config.method" },
  { code: "unknown_node_type", message: "unknown node type 'x'", node_id: "b" },
  { code: "unknown_edge_node", message: "edge references unknown node 'z'", edge: { from: "a", to: "z" } },
  { code: "invalid_config", message: "deep", node_id: "c", path: "config.body.x" },
];

describe("issues", () => {
  it("groups by node and leaves out issues with no node", () => {
    const m = issuesByNode(issues);
    expect([...m.keys()]).toEqual(["a", "b", "c"]);
    expect(m.get("a")).toHaveLength(2);
  });
  it("finds the message for one field, including nested paths", () => {
    expect(fieldMessage(issues, "method")).toMatch(/FETCH/);
    expect(fieldMessage(issues, "body")).toBe("deep");
    expect(fieldMessage(issues, "url")).toBeUndefined(); // path "config" alone is node-level
  });
  it("treats a problem with the config as a whole as node-level, and field problems as field-level", () => {
    // path "config" = the whole config (e.g. a missing required key); "config.method" = one field
    expect(nodeLevel(issues.filter((i) => i.node_id === "a")).map((i) => i.path)).toEqual(["config"]);
    expect(nodeLevel(issues.filter((i) => i.node_id === "b"))).toHaveLength(1); // no path at all
    expect(nodeLevel(issues.filter((i) => i.node_id === "c"))).toEqual([]);     // only a field problem
  });
  it("lists graph-wide problems separately", () => expect(unattached(issues)).toHaveLength(1));
  it("pluralizes", () => expect([describeProblems(1), describeProblems(3)]).toEqual(["1 problem", "3 problems"]));
});
