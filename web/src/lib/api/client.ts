import type { Issue } from "./types";

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const TOKEN_KEY = "fm_token";

// ---- token storage ---------------------------------------------------------------
// sessionStorage: gone when the tab closes. Readable by any script on the page, so
// an XSS bug could steal it; the token lives 15 minutes, which limits the damage.
// (A production setup would use an httpOnly cookie. See the gaps list.)
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const tokenStore = {
  get(): string | null {
    if (typeof window === "undefined") return null;
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    sessionStorage.setItem(TOKEN_KEY, token);
    emit();
  },
  clear() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

// ---- errors -------------------------------------------------------------------------
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }

  /** Validation issues, when the server sent {message, issues: [...]} */
  get issues(): Issue[] {
    const d = this.detail;
    if (d && typeof d === "object" && "issues" in d && Array.isArray((d as { issues: unknown }).issues)) {
      return (d as { issues: Issue[] }).issues;
    }
    return [];
  }
}

function messageFrom(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    // FastAPI request validation: [{loc: [...], msg: "..."}]
    const first = detail[0] as { loc?: unknown[]; msg?: string };
    const where = (first.loc ?? []).filter((p) => p !== "body").join(".");
    return first.msg ? (where ? `${where}: ${first.msg}` : first.msg) : fallback;
  }
  if (detail && typeof detail === "object" && "message" in detail && typeof (detail as { message: unknown }).message === "string") {
    return (detail as { message: string }).message;
  }
  return fallback;
}

// ---- requests -----------------------------------------------------------------------
export type ApiResult<T> = { data: T; headers: Headers; status: number };
type Init = Omit<RequestInit, "body"> & { json?: unknown };

export async function request<T>(path: string, init: Init = {}): Promise<ApiResult<T>> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  const token = tokenStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body: string | undefined;
  if (json !== undefined) {
    body = JSON.stringify(json);
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...rest, headers, body });
  } catch {
    throw new ApiError(0, `Cannot reach the API at ${BASE}. Is it running?`);
  }

  // A 401 on a request that carried a token means it expired or is invalid:
  // forget it, and the auth gate sends the user to /login.
  if (res.status === 401 && token) tokenStore.clear();

  if (!res.ok) {
    let detail: unknown;
    try {
      detail = ((await res.json()) as { detail?: unknown }).detail;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, messageFrom(detail, res.statusText || `HTTP ${res.status}`), detail);
  }
  const text = res.status === 204 ? "" : await res.text();
  return { data: (text ? JSON.parse(text) : undefined) as T, headers: res.headers, status: res.status };
}

export async function api<T>(path: string, init?: Init): Promise<T> {
  return (await request<T>(path, init)).data;
}
