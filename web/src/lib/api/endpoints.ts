import { api } from "./client";
import type { Definition } from "@/lib/definition";
import type {
  Draft, Me, NodeType, PublishResult, SaveResult, ValidateResult, VersionDetail,
  WorkflowDetail, WorkflowSummary, Workspace,
} from "./types";

// Query keys in one place, so invalidation never misses a typo.
export const qk = {
  me: ["me"] as const,
  workspaces: ["workspaces"] as const,
  workflows: (workspaceId: string, archived: boolean) => ["workflows", workspaceId, archived] as const,
  workflowsOf: (workspaceId: string) => ["workflows", workspaceId] as const,
  draft: (workflowId: string) => ["draft", workflowId] as const,
  workflow: (workflowId: string) => ["workflow", workflowId] as const,
  nodeTypes: ["node-types"] as const,
  version: (workflowId: string, version: number) => ["version", workflowId, version] as const,
};

// ---- auth ---------------------------------------------------------------------------
export const register = (email: string, password: string) =>
  api<{ id: string; email: string }>("/v1/auth/register", { method: "POST", json: { email, password } });

export const login = (email: string, password: string) =>
  api<{ access_token: string; expires_in: number }>("/v1/auth/login", { method: "POST", json: { email, password } });

export const fetchMe = () => api<Me>("/v1/me");

// ---- workspaces ---------------------------------------------------------------------
export const listWorkspaces = () => api<Workspace[]>("/v1/workspaces");

export const createWorkspace = (name: string, slug: string) =>
  api<{ id: string; name: string; slug: string }>("/v1/workspaces", { method: "POST", json: { name, slug } });

// ---- workflows ----------------------------------------------------------------------
export const listWorkflows = (workspaceId: string, includeArchived: boolean) =>
  api<WorkflowSummary[]>(`/v1/workspaces/${workspaceId}/workflows?include_archived=${includeArchived}`);

export const createWorkflow = (workspaceId: string, name: string) =>
  api<{ id: string; name: string }>(`/v1/workspaces/${workspaceId}/workflows`, { method: "POST", json: { name } });

export const patchWorkflow = (id: string, patch: { name?: string; description?: string; is_active?: boolean }) =>
  api<{ id: string; name: string; is_active: boolean }>(`/v1/workflows/${id}`, { method: "PATCH", json: patch });

export const getWorkflow = (id: string) => api<WorkflowDetail>(`/v1/workflows/${id}`);

export const getDraft = (workflowId: string) => api<Draft>(`/v1/workflows/${workflowId}/draft`);

// ---- the node catalog -----------------------------------------------------------------
export const getNodeTypes = () => api<NodeType[]>("/v1/node-types");

// ---- editing: save, validate, publish -------------------------------------------------
/** `etag` is the value from the last read or save, quotes included. A stale one gets 412. */
export const putDraft = (workflowId: string, definition: Definition, etag: string) =>
  api<SaveResult>(`/v1/workflows/${workflowId}/draft`, { method: "PUT", json: { definition }, headers: { "If-Match": etag } });

export const validateDefinition = (workflowId: string, definition: Definition) =>
  api<ValidateResult>(`/v1/workflows/${workflowId}/validate`, { method: "POST", json: { definition } });

export const publishDraft = (workflowId: string, etag: string) =>
  api<PublishResult>(`/v1/workflows/${workflowId}/publish`, { method: "POST", headers: { "If-Match": etag } });

export const getVersion = (workflowId: string, version: number) =>
  api<VersionDetail>(`/v1/workflows/${workflowId}/versions/${version}`);
