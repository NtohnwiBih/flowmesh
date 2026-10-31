import { describe, expect, it } from "vitest";
import { clientErrors, fieldsFromSchema, parseJsonField, parseNumber, setField } from "./schema-form";
import { catalog, typeById } from "./test-helpers";

describe("fieldsFromSchema, against the real catalog", () => {
  it("turns the http schema into the three fields the editor shows", () => {
    const fields = fieldsFromSchema(typeById("http").config_schema);
    expect(fields.map((f) => [f.key, f.kind, f.required])).toEqual([
      ["method", "select", false],
      ["url", "text", true],
      ["body", "json", false],
    ]);
  });

  it("carries labels, options, defaults and descriptions through", () => {
    const [method, url] = fieldsFromSchema(typeById("http").config_schema);
    expect(method).toMatchObject({ label: "Method", defaultValue: "GET", options: ["GET", "POST", "PUT", "PATCH", "DELETE"] });
    expect(url.label).toBe("URL");
    expect(url.description).toMatch(/templates/);
  });

  it.each(catalog.map((t) => [t.id, t] as const))("every field of %s is one the form can render", (_id, t) => {
    for (const f of fieldsFromSchema(t.config_schema)) {
      expect(["text", "select", "number", "integer", "boolean", "json"]).toContain(f.kind);
      expect(f.label.length).toBeGreaterThan(0);
    }
  });

  it("gives steps with no settings no fields", () => {
    expect(fieldsFromSchema(typeById("webhook").config_schema)).toEqual([]);
    expect(fieldsFromSchema(undefined)).toEqual([]);
  });

  it("maps each JSON Schema type to a field kind and humanizes bare keys", () => {
    const fields = fieldsFromSchema({
      type: "object",
      required: ["count"],
      properties: {
        retry_delay: { type: "integer" }, ratio: { type: "number" }, enabled: { type: "boolean" },
        mode: { enum: ["a", "b"] }, payload: { type: "object" }, count: { type: "integer", minimum: 1 },
      },
    });
    expect(fields.map((f) => [f.key, f.kind, f.label])).toEqual([
      ["retry_delay", "integer", "Retry delay"], ["ratio", "number", "Ratio"], ["enabled", "boolean", "Enabled"],
      ["mode", "select", "Mode"], ["payload", "json", "Payload"], ["count", "integer", "Count"],
    ]);
    expect(fields.find((f) => f.key === "count")?.required).toBe(true);
  });
});

describe("setField", () => {
  it("sets and replaces a value without mutating the original", () => {
    const a = { url: "x" };
    const b = setField(a, "method", "POST");
    expect(b).toEqual({ url: "x", method: "POST" });
    expect(a).toEqual({ url: "x" });
  });
  it("removes the key when cleared, and returns undefined when nothing is left", () => {
    expect(setField({ url: "x", method: "POST" }, "method", "")).toEqual({ url: "x" });
    expect(setField({ url: "x" }, "url", undefined)).toBeUndefined();
    expect(setField(undefined, "url", "")).toBeUndefined();
  });
  it("keeps falsy values that are real (false, 0)", () => {
    expect(setField(undefined, "enabled", false)).toEqual({ enabled: false });
    expect(setField(undefined, "n", 0)).toEqual({ n: 0 });
  });
});

describe("parsing", () => {
  it.each([["42", "integer", 42], ["3.5", "number", 3.5], ["", "integer", undefined], ["abc", "number", "invalid"], ["3.5", "integer", "invalid"], ["Infinity", "number", "invalid"]] as const)(
    "parseNumber(%j, %s)", (raw, kind, want) => expect(parseNumber(raw, kind)).toBe(want),
  );
  it("parses JSON, treats empty as cleared, and explains errors", () => {
    expect(parseJsonField('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonField("  ")).toEqual({ ok: true, value: undefined });
    const bad = parseJsonField("{oops");
    expect(bad.ok).toBe(false);
  });
});

describe("clientErrors", () => {
  const fields = fieldsFromSchema(typeById("http").config_schema);
  it("flags a missing required field", () => expect(clientErrors(fields, undefined)).toEqual({ url: "Required" }));
  it("flags a too-short value and accepts a good one", () => {
    expect(clientErrors(fields, { url: "" })).toEqual({ url: "Required" });
    expect(clientErrors(fields, { url: "http://x" })).toEqual({});
  });
  it("flags a value outside an enum", () => {
    expect(clientErrors(fields, { url: "http://x", method: "FETCH" }).method).toMatch(/Choose one of/);
  });
  it("checks numeric bounds", () => {
    const f = fieldsFromSchema({ type: "object", properties: { n: { type: "integer", minimum: 1, maximum: 5 } } });
    expect(clientErrors(f, { n: 0 }).n).toMatch(/at least 1/);
    expect(clientErrors(f, { n: 9 }).n).toMatch(/at most 5/);
    expect(clientErrors(f, { n: 3 })).toEqual({});
  });
});
