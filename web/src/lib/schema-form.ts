// Turns a node type's JSON Schema (from GET /v1/node-types) into form fields, and
// edits a node's `config` object. Pure: no React. The server stays the authority;
// the checks here only catch obvious mistakes while someone is typing.

import type { JsonSchema } from "./api/types";

export type Config = Record<string, unknown>;
export type FieldKind = "text" | "select" | "number" | "integer" | "boolean" | "json";

export type Field = {
  key: string;
  label: string;
  description?: string;
  required: boolean;
  kind: FieldKind;
  options?: string[];
  defaultValue?: unknown;
  maxLength?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
};

const humanize = (key: string) => key.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function kindOf(prop: JsonSchema): FieldKind {
  if (Array.isArray(prop.enum) && prop.enum.every((v) => typeof v === "string")) return "select";
  switch (prop.type) {
    case "string": return "text";
    case "integer": return "integer";
    case "number": return "number";
    case "boolean": return "boolean";
    default: return "json"; // objects, arrays, and "anything" (no type)
  }
}

export function fieldsFromSchema(schema: JsonSchema | undefined): Field[] {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  return Object.entries(props).map(([key, prop]) => ({
    key,
    label: prop.title ?? humanize(key),
    description: prop.description,
    required: required.has(key),
    kind: kindOf(prop),
    options: prop.enum as string[] | undefined,
    defaultValue: prop.default,
    maxLength: prop.maxLength,
    minLength: prop.minLength,
    minimum: prop.minimum,
    maximum: prop.maximum,
  }));
}

/** Set one field. An empty value removes the key, so config stays minimal and a cleared
 *  optional field falls back to the default. Returns undefined when nothing is left. */
export function setField(config: Config | undefined, key: string, value: unknown): Config | undefined {
  const next: Config = { ...(config ?? {}) };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value;
  return Object.keys(next).length === 0 ? undefined : next;
}

/** "42" -> 42. Empty -> undefined (clears the field). Not a number, or not whole when it must be -> "invalid". */
export function parseNumber(raw: string, kind: "number" | "integer"): number | undefined | "invalid" {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return "invalid";
  if (kind === "integer" && !Number.isInteger(n)) return "invalid";
  return n;
}

export function parseJsonField(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (raw.trim() === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.replace(/^JSON\.parse: /, "") : "Not valid JSON" };
  }
}

/** Quick client-side checks, keyed by field. The API re-checks everything on save and publish. */
export function clientErrors(fields: Field[], config: Config | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = config?.[f.key];
    if (v === undefined) {
      if (f.required) out[f.key] = "Required";
      continue;
    }
    if (f.kind === "text" && typeof v === "string") {
      if (f.minLength !== undefined && v.length < f.minLength) out[f.key] = f.minLength === 1 ? "Required" : `At least ${f.minLength} characters`;
      else if (f.maxLength !== undefined && v.length > f.maxLength) out[f.key] = `At most ${f.maxLength} characters`;
    } else if ((f.kind === "number" || f.kind === "integer") && typeof v === "number") {
      if (f.minimum !== undefined && v < f.minimum) out[f.key] = `Must be at least ${f.minimum}`;
      else if (f.maximum !== undefined && v > f.maximum) out[f.key] = `Must be at most ${f.maximum}`;
    } else if (f.kind === "select" && f.options && !f.options.includes(String(v))) {
      out[f.key] = `Choose one of: ${f.options.join(", ")}`;
    }
  }
  return out;
}
