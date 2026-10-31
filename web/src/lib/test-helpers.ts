// Shared by tests only: the API's node catalog, from the shared fixture.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NodeType } from "./api/types";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../schemas/fixtures");

export const catalog: NodeType[] = JSON.parse(fs.readFileSync(path.join(FIXTURES, "node-types.json"), "utf8"));
export const typeById = (id: string): NodeType => {
  const t = catalog.find((x) => x.id === id);
  if (!t) throw new Error(`catalog has no ${id}`);
  return t;
};
