// Helpers for the validation issues the API returns (from save, validate and publish).

import type { Issue } from "./api/types";

export function issuesByNode(issues: Issue[]): Map<string, Issue[]> {
  const map = new Map<string, Issue[]>();
  for (const i of issues) {
    if (!i.node_id) continue;
    map.set(i.node_id, [...(map.get(i.node_id) ?? []), i]);
  }
  return map;
}

/** Issues that are about the graph as a whole, with no node to point at. */
export const unattached = (issues: Issue[]) => issues.filter((i) => !i.node_id);

/** The message for one config field, from paths like "config.url" or "config.body.x". */
export function fieldMessage(issues: Issue[], key: string): string | undefined {
  const prefix = `config.${key}`;
  return issues.find((i) => i.path === prefix || i.path?.startsWith(`${prefix}.`))?.message;
}

/** Issues about the node itself rather than one of its config fields. */
export const nodeLevel = (issues: Issue[]) => issues.filter((i) => !i.path?.startsWith("config."));

export const describeProblems = (n: number) => (n === 1 ? "1 problem" : `${n} problems`);
