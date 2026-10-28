import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, request, tokenStore } from "./client";

// The client runs in the browser, so give the node test environment a tiny
// stand-in for window and sessionStorage.
function stubBrowser() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {});
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
}
const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stubBrowser();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("request", () => {
  it("sends the bearer token and JSON bodies", async () => {
    tokenStore.set("tok");
    fetchMock.mockResolvedValue(reply(200, { ok: 1 }));
    await api("/v1/x", { method: "POST", json: { a: 1 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8080/v1/x");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer tok");
    expect((init.headers as Headers).get("Content-Type")).toBe("application/json");
    expect(init.body).toBe('{"a":1}');
  });

  it("returns response headers (the draft ETag travels there)", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: { ETag: '"3"' } }));
    expect((await request("/v1/x")).headers.get("etag")).toBe('"3"');
  });

  it("handles 204 with no body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await api("/v1/x", { method: "DELETE" })).toBeUndefined();
  });
});

describe("errors", () => {
  const failWith = async (status: number, body?: unknown): Promise<ApiError> => {
    fetchMock.mockResolvedValue(reply(status, body));
    try {
      await api("/v1/x");
    } catch (e) {
      return e as ApiError;
    }
    throw new Error("expected the request to fail");
  };

  it("uses a plain string detail", async () => {
    const e = await failWith(409, { detail: "slug already in use" });
    expect(e).toBeInstanceOf(ApiError);
    expect([e.status, e.message]).toEqual([409, "slug already in use"]);
  });

  it("turns FastAPI validation arrays into a readable message", async () => {
    const e = await failWith(422, { detail: [{ loc: ["body", "password"], msg: "String should have at least 10 characters" }] });
    expect(e.message).toBe("password: String should have at least 10 characters");
  });

  it("keeps validation issues from a failed publish", async () => {
    const issues = [{ code: "unknown_node_type", message: "unknown node type 'x'", node_id: "a" }];
    const e = await failWith(422, { detail: { message: "definition failed validation", issues } });
    expect(e.message).toBe("definition failed validation");
    expect(e.issues).toEqual(issues);
  });

  it("falls back to the status text for non-JSON errors", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
    const e = (await api("/v1/x").catch((x: unknown) => x)) as ApiError;
    expect([e.status, e.message]).toEqual([502, "Bad Gateway"]);
  });

  it("explains an unreachable API", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const e = (await api("/v1/x").catch((x: unknown) => x)) as ApiError;
    expect(e.status).toBe(0);
    expect(e.message).toMatch(/Cannot reach the API/);
  });
});

describe("expired sessions", () => {
  it("a 401 on an authenticated request forgets the token and notifies listeners", async () => {
    tokenStore.set("old");
    const seen = vi.fn();
    const off = tokenStore.subscribe(seen);
    fetchMock.mockResolvedValue(reply(401, { detail: "not authenticated" }));
    await api("/v1/me").catch(() => undefined);
    expect(tokenStore.get()).toBeNull();
    expect(seen).toHaveBeenCalled();
    off();
  });

  it("a failed login (no token was sent) is just an error, not a sign-out", async () => {
    tokenStore.clear();
    const seen = vi.fn();
    const off = tokenStore.subscribe(seen);
    fetchMock.mockResolvedValue(reply(401, { detail: "invalid email or password" }));
    const e = (await api("/v1/auth/login", { method: "POST", json: {} }).catch((x: unknown) => x)) as ApiError;
    expect(e.message).toBe("invalid email or password");
    expect(seen).not.toHaveBeenCalled();
    off();
  });
});
