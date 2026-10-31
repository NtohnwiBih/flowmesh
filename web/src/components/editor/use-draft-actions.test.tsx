// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import { ApiError } from "@/lib/api/client";
import type { Definition } from "@/lib/definition";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/api/endpoints", () => ({
  putDraft: vi.fn(), validateDefinition: vi.fn(), publishDraft: vi.fn(), getDraft: vi.fn(),
}));

import { getDraft, publishDraft, putDraft, validateDefinition } from "@/lib/api/endpoints";
import { toast } from "sonner";
import { useDraftActions, type DraftMeta } from "./use-draft-actions";

const def = (n = 1): Definition => ({
  schema_version: 1,
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, type: "http", config: { url: "http://x" } })),
  edges: [],
});
const meta: DraftMeta = { etag: '"1"', revision: 1, base_version: 1, production_version: 1, has_unpublished_changes: false, staging_verified: false };
const saveOk = (rev: number, issues: never[] | { code: string; message: string; node_id: string }[] = []) =>
  ({ etag: `"${rev}"`, revision: rev, updated_at: "now", issues });

function setup(initial = def(1), readOnly = false, onPublished?: (v: number) => void) {
  return renderHook(({ d }: { d: Definition }) => useDraftActions({ workflowId: "wf", definition: d, readOnly, initialMeta: meta, initialDefinition: initial, onPublished }),
    { initialProps: { d: initial } });
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("dirty tracking", () => {
  it("is clean on load, dirty after an edit, clean again when the edit is undone", () => {
    const { result, rerender } = setup();
    expect(result.current.dirty).toBe(false);
    rerender({ d: def(2) });
    expect(result.current.dirty).toBe(true);
    rerender({ d: def(1) });
    expect(result.current.dirty).toBe(false);
  });
  it("is never dirty when read-only", () => {
    const { result, rerender } = setup(def(1), true);
    rerender({ d: def(2) });
    expect(result.current.dirty).toBe(false);
  });
});

describe("save", () => {
  it("sends the current definition with the last ETag, then adopts the new one", async () => {
    vi.mocked(putDraft).mockResolvedValue(saveOk(2));
    const { result, rerender } = setup();
    rerender({ d: def(2) });
    await act(() => result.current.save());
    expect(putDraft).toHaveBeenCalledWith("wf", def(2), '"1"');
    expect(result.current.meta).toMatchObject({ etag: '"2"', revision: 2, has_unpublished_changes: true });
    expect(result.current.dirty).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Saved");
  });

  it("uses the new ETag for the next save", async () => {
    vi.mocked(putDraft).mockResolvedValueOnce(saveOk(2)).mockResolvedValueOnce(saveOk(3));
    const { result, rerender } = setup();
    rerender({ d: def(2) });
    await act(() => result.current.save());
    rerender({ d: def(3) });
    await act(() => result.current.save());
    expect(vi.mocked(putDraft).mock.calls.map((c) => c[2])).toEqual(['"1"', '"2"']);
  });

  it("keeps edits made WHILE saving marked unsaved", async () => {
    let finish!: (v: ReturnType<typeof saveOk>) => void;
    vi.mocked(putDraft).mockReturnValue(new Promise((r) => { finish = r; }));
    const { result, rerender } = setup();
    rerender({ d: def(2) });
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.save(); });
    rerender({ d: def(3) }); // the user keeps typing
    await act(async () => { finish(saveOk(2)); await pending; });
    expect(result.current.dirty).toBe(true); // the 3-node version was never sent
  });

  it("ignores a second save while one is in flight", async () => {
    let finish!: (v: ReturnType<typeof saveOk>) => void;
    vi.mocked(putDraft).mockReturnValue(new Promise((r) => { finish = r; }));
    const { result, rerender } = setup();
    rerender({ d: def(2) });
    let first!: Promise<unknown>;
    act(() => { first = result.current.save(); void result.current.save(); });
    await act(async () => { finish(saveOk(2)); await first; });
    expect(putDraft).toHaveBeenCalledTimes(1);
  });

  it("keeps problems the server reports, and says so", async () => {
    const issues = [{ code: "invalid_config", message: "'url' is required", node_id: "n0" }];
    vi.mocked(putDraft).mockResolvedValue(saveOk(2, issues));
    const { result, rerender } = setup();
    rerender({ d: def(2) });
    await act(() => result.current.save());
    expect(result.current.issues).toEqual(issues);
    expect(toast.warning).toHaveBeenCalled();
  });

  it("a stale ETag opens the conflict dialog and leaves the edits alone", async () => {
    vi.mocked(putDraft).mockRejectedValue(new ApiError(412, "changed"));
    const { result, rerender } = setup();
    rerender({ d: def(2) });
    await act(() => result.current.save());
    expect(result.current.conflict).toBe(true);
    expect(result.current.dirty).toBe(true);
  });

  it("reports other failures without a conflict", async () => {
    vi.mocked(putDraft).mockRejectedValue(new ApiError(500, "boom"));
    const { result, rerender } = setup();
    rerender({ d: def(2) });
    await act(() => result.current.save());
    expect(result.current.conflict).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Could not save", { description: "boom" });
  });

  it("does nothing when read-only", async () => {
    const { result } = setup(def(1), true);
    await act(() => result.current.save());
    expect(putDraft).not.toHaveBeenCalled();
  });
});

describe("validate", () => {
  it("shows the problems the API finds", async () => {
    const issues = [{ code: "unknown_node_type", message: "unknown node type 'x'", node_id: "n0" }];
    vi.mocked(validateDefinition).mockResolvedValue({ valid: false, issues });
    const { result } = setup();
    await act(() => result.current.validate());
    expect(validateDefinition).toHaveBeenCalledWith("wf", def(1));
    expect(result.current.issues).toEqual(issues);
  });
  it("clears old problems when the draft is fine", async () => {
    vi.mocked(validateDefinition).mockResolvedValueOnce({ valid: false, issues: [{ code: "x", message: "m", node_id: "n0" }] })
      .mockResolvedValueOnce({ valid: true, issues: [] });
    const { result } = setup();
    await act(() => result.current.validate());
    await act(() => result.current.validate());
    expect(result.current.issues).toEqual([]);
  });
});

describe("publish", () => {
  const published = { id: "v", version: 2, created_at: "now", staging_verified: false, warnings: [] };

  it("publishes a clean draft with the current ETag, without saving", async () => {
    vi.mocked(publishDraft).mockResolvedValue(published);
    const { result } = setup();
    let ok = false;
    await act(async () => { ok = await result.current.publish(); });
    expect(ok).toBe(true);
    expect(putDraft).not.toHaveBeenCalled();
    expect(publishDraft).toHaveBeenCalledWith("wf", '"1"');
    expect(result.current.meta).toMatchObject({ production_version: 2, base_version: 2, has_unpublished_changes: false });
  });

  it("saves first when there are unsaved edits, and publishes what it saved", async () => {
    vi.mocked(putDraft).mockResolvedValue(saveOk(2));
    vi.mocked(publishDraft).mockResolvedValue(published);
    const { result, rerender } = setup();
    rerender({ d: def(2) });
    await act(async () => { await result.current.publish(); });
    expect(putDraft).toHaveBeenCalledWith("wf", def(2), '"1"');
    expect(publishDraft).toHaveBeenCalledWith("wf", '"2"'); // the NEW stamp, not the stale one
  });

  it("tells the page which version went live, and only on success", async () => {
    const onPublished = vi.fn();
    vi.mocked(publishDraft).mockResolvedValueOnce(published).mockRejectedValueOnce(new ApiError(500, "x"));
    const { result } = setup(def(1), false, onPublished);
    await act(async () => { await result.current.publish(); });
    expect(onPublished).toHaveBeenCalledWith(2);
    onPublished.mockClear();
    await act(async () => { await result.current.publish(); });
    expect(onPublished).not.toHaveBeenCalled();
  });

  it("does not publish when the save reports problems", async () => {
    vi.mocked(putDraft).mockResolvedValue(saveOk(2, [{ code: "invalid_config", message: "bad", node_id: "n0" }]));
    const { result, rerender } = setup();
    rerender({ d: def(2) });
    let ok = true;
    await act(async () => { ok = await result.current.publish(); });
    expect(ok).toBe(false);
    expect(publishDraft).not.toHaveBeenCalled();
    expect(result.current.issues).toHaveLength(1);
  });

  it("surfaces the API's own refusal on the steps", async () => {
    const issues = [{ code: "node_type_unavailable", message: "Condition is not available yet", node_id: "n0" }];
    vi.mocked(publishDraft).mockRejectedValue(new ApiError(422, "failed", { message: "failed", issues }));
    const { result } = setup();
    let ok = true;
    await act(async () => { ok = await result.current.publish(); });
    expect(ok).toBe(false);
    expect(result.current.issues).toEqual(issues);
    expect(result.current.meta.production_version).toBe(1); // unchanged
  });

  it("a stale ETag during publish opens the conflict dialog", async () => {
    vi.mocked(publishDraft).mockRejectedValue(new ApiError(412, "changed"));
    const { result } = setup();
    await act(async () => { await result.current.publish(); });
    expect(result.current.conflict).toBe(true);
  });

  it("is blocked for read-only viewers", async () => {
    const { result } = setup(def(1), true);
    await act(async () => { await result.current.publish(); });
    expect(publishDraft).not.toHaveBeenCalled();
  });
});

describe("conflict resolution", () => {
  it("'keep mine' fetches the latest stamp, saves over it, and clears the conflict", async () => {
    vi.mocked(putDraft).mockRejectedValueOnce(new ApiError(412, "changed"));
    const { result, rerender } = setup();
    rerender({ d: def(2) });
    await act(() => result.current.save());
    expect(result.current.conflict).toBe(true);

    vi.mocked(getDraft).mockResolvedValue({ etag: '"7"' } as never);
    vi.mocked(putDraft).mockResolvedValueOnce(saveOk(8));
    await act(() => result.current.overwrite());
    expect(putDraft).toHaveBeenLastCalledWith("wf", def(2), '"7"');
    await waitFor(() => expect(result.current.conflict).toBe(false));
    expect(result.current.dirty).toBe(false);
    expect(result.current.meta.etag).toBe('"8"');
  });
});
