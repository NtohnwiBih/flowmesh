// Pure helpers: no React, no browser APIs. Tested in slug.test.ts.

function ascii(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** A readable node id from a label: "Fetch customer" -> "fetch_customer".
 *  Ids appear in templates ({{ nodes.fetch_customer.status }}), so they use only
 *  [a-z0-9_] (never "."), stay under the 100-character database limit, and are
 *  unique within the workflow. A node keeps its id when it is renamed. */
export function makeNodeId(label: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const base = ascii(label).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 90) || "node";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A workspace slug that satisfies the API pattern ^[a-z0-9][a-z0-9-]{0,62}$ */
export function slugifyWorkspace(name: string): string {
  const s = ascii(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63).replace(/-+$/, "");
  return s || "workspace";
}

export const WORKSPACE_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
