import { describe, expect, it } from "vitest";
import { makeNodeId, slugifyWorkspace, WORKSPACE_SLUG } from "./slug";

describe("makeNodeId", () => {
  it("makes readable ids", () => {
    expect(makeNodeId("Fetch customer", [])).toBe("fetch_customer");
    expect(makeNodeId("  High priority? ", [])).toBe("high_priority");
    expect(makeNodeId("Café Ünïcode", [])).toBe("cafe_unicode");
  });
  it("never contains a dot (templates split paths on dots)", () => {
    expect(makeNodeId("v1.2.3 fetch", [])).not.toContain(".");
  });
  it("falls back for labels with no usable characters", () => {
    expect(makeNodeId("???", [])).toBe("node");
    expect(makeNodeId("", [])).toBe("node");
  });
  it("keeps ids unique", () => {
    expect(makeNodeId("Fetch", ["fetch"])).toBe("fetch_2");
    expect(makeNodeId("Fetch", ["fetch", "fetch_2"])).toBe("fetch_3");
  });
  it("stays within the 100 character database limit even with a suffix", () => {
    const id = makeNodeId("x".repeat(500), ["x".repeat(90)]);
    expect(id.length).toBeLessThanOrEqual(100);
  });
});

describe("slugifyWorkspace", () => {
  it.each(["Acme Engineering", "  --Weird__Name!! ", "日本語", "a".repeat(200), "9 lives", "-", ""])(
    "always satisfies the API pattern: %j",
    (name) => expect(WORKSPACE_SLUG.test(slugifyWorkspace(name))).toBe(true),
  );
  it("produces the expected slug", () => {
    expect(slugifyWorkspace("Acme Engineering")).toBe("acme-engineering");
  });
});
