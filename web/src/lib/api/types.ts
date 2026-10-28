import type { Definition } from "@/lib/definition";

export type Role = "viewer" | "editor" | "admin";
export type EnvKey = "staging" | "production";

export type Issue = {
  code: string;
  message: string;
  node_id?: string;
  edge?: { from: string; to: string };
  path?: string;
};

export type Me = { id: string; email: string; created_at: string };
export type Workspace = { id: string; name: string; slug: string; role: Role };

export type WorkflowSummary = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean; // false = archived
  created_at: string;
  latest_version: number | null;
  production_version: number | null;
};

export type Draft = {
  definition: Definition;
  base_version: number | null;
  production_version: number | null;
  has_unpublished_changes: boolean;
  staging_verified: boolean;
  revision: number;
  etag: string;
  updated_at: string;
};

export const canEdit = (role: Role | null | undefined) => role === "editor" || role === "admin";
export const isAdmin = (role: Role | null | undefined) => role === "admin";

export type WorkflowDetail = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  production_version: number | null;
};
