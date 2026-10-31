// @vitest-environment jsdom
// Renders the real editor, including React Flow, and drives it like a person would.
// Only the network is faked.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ApiError } from "@/lib/api/client";
import type { Definition } from "@/lib/definition";
import { catalog } from "@/lib/test-helpers";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/api/endpoints", () => ({ putDraft: vi.fn(), validateDefinition: vi.fn(), publishDraft: vi.fn(), getDraft: vi.fn() }));

import { publishDraft, putDraft, validateDefinition } from "@/lib/api/endpoints";
import { WorkflowEditor, type WorkflowEditorProps } from "./editor";

// jsdom has no layout engine. React Flow needs these to measure and draw.
beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("DOMMatrixReadOnly", class { m22 = 1; });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
});

const DEF: Definition = {
  schema_version: 1,
  nodes: [
    { id: "hook", type: "webhook", name: "Order webhook", ui: { x: 50, y: 120 } },
    { id: "fetch", type: "http", name: "Fetch order", config: { url: "http://x/{{ nodes.hook.body.id }}" }, ui: { x: 340, y: 120 } },
  ],
  edges: [{ from: "hook", to: "fetch" }],
};
const META = { etag: '"1"', revision: 1, base_version: 1, production_version: 1, has_unpublished_changes: false, staging_verified: false };

function mount(over: Partial<WorkflowEditorProps> = {}) {
  const props: WorkflowEditorProps = {
    workflow: { id: "wf", name: "Order flow", is_active: true }, definition: DEF, view: "staging", canEdit: true,
    draft: META, nodeTypes: catalog, onSwitchView: vi.fn(), onReload: vi.fn(), ...over,
  };
  render(<WorkflowEditor {...props} />);
  return props;
}
const button = (name: RegExp | string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const status = () => screen.getAllByRole("status").map((e) => e.textContent).join(" | ");

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("loading a draft", () => {
  it("draws the saved steps, and starts clean", () => {
    mount();
    expect(screen.getByTestId("node-hook")).toBeTruthy();
    expect(screen.getByTestId("node-fetch").textContent).toMatch(/Fetch order/);
    expect(screen.getByTestId("node-fetch").textContent).toMatch(/Configure this step|http:\/\/x/);
    expect(status()).toMatch(/All changes saved/);
    expect(button(/^Save/).disabled).toBe(true);
    expect(screen.getByText(/2 steps · 1 connections/)).toBeTruthy();
  });

  it("says which copy this is, and what is live", () => {
    mount();
    expect(status()).toMatch(/Staging draft · v1 live/);
    expect(status()).toMatch(/matches production/);
  });
});

describe("editing and saving", () => {
  it("editing a setting marks the draft unsaved and enables Save", () => {
    mount();
    fireEvent.click(screen.getByText("Fetch order"));
    fireEvent.change(screen.getByLabelText(/^URL/), { target: { value: "http://changed/{{ nodes.hook.body.id }}" } });
    expect(status()).toMatch(/Unsaved changes/);
    expect(button(/^Save/).disabled).toBe(false);
    expect(screen.getByTestId("node-fetch").textContent).toMatch(/http:\/\/changed/); // the card subtitle follows the config
  });

  it("saves the canonical definition with the ETag, then reads clean again", async () => {
    vi.mocked(putDraft).mockResolvedValue({ etag: '"2"', revision: 2, updated_at: "now", issues: [] });
    mount();
    fireEvent.click(screen.getByText("Fetch order"));
    fireEvent.change(screen.getByLabelText(/^URL/), { target: { value: "http://changed" } });
    fireEvent.click(button(/^Save/));
    await waitFor(() => expect(status()).toMatch(/All changes saved/));
    const [wfId, saved, etag] = vi.mocked(putDraft).mock.calls[0];
    expect([wfId, etag]).toEqual(["wf", '"1"']);
    const fetchNode = (saved as Definition).nodes.find((n) => n.id === "fetch")!;
    expect(fetchNode.config).toEqual({ url: "http://changed" });
    expect(fetchNode.name).toBe("Fetch order");
    expect((saved as Definition).edges).toEqual([{ from: "hook", to: "fetch" }]);
  });

  it("renaming a step keeps its id, so templates that mention it keep working", async () => {
    vi.mocked(putDraft).mockResolvedValue({ etag: '"2"', revision: 2, updated_at: "now", issues: [] });
    mount();
    fireEvent.click(screen.getByText("Fetch order"));
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Get the order" } });
    fireEvent.click(button(/^Save/));
    await waitFor(() => expect(putDraft).toHaveBeenCalled());
    const saved = vi.mocked(putDraft).mock.calls[0][1] as Definition;
    expect(saved.nodes[1]).toMatchObject({ id: "fetch", name: "Get the order" });
  });

  it("adds a step from the palette, with a readable id", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^HTTP Request/ }));
    expect(screen.getByTestId("node-http_request")).toBeTruthy();
    expect(screen.getByText(/3 steps/)).toBeTruthy();
    expect(status()).toMatch(/Unsaved changes/);
  });

  it("refuses a second trigger, and steps that are not available yet", async () => {
    const { toast } = await import("sonner");
    mount();
    expect(button(/Condition/).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^Webhook/ }));
    expect(toast.error).toHaveBeenCalledWith("A workflow can have only one trigger.");
    expect(screen.getByText(/2 steps/)).toBeTruthy();
  });

  it("deletes a step and the connections touching it", () => {
    mount();
    fireEvent.click(screen.getByText("Fetch order"));
    fireEvent.click(button(/delete step/i));
    expect(screen.queryByTestId("node-fetch")).toBeNull();
    expect(screen.getByText(/1 steps · 0 connections/)).toBeTruthy();
  });
});

describe("problems", () => {
  it("marks the steps the API complains about, and lists them in the toolbar", async () => {
    vi.mocked(validateDefinition).mockResolvedValue({
      valid: false,
      issues: [{ code: "invalid_config", node_id: "fetch", path: "config.url", message: "is not a valid URL" }],
    });
    mount();
    fireEvent.click(button(/Validate/));
    await waitFor(() => expect(within(screen.getByTestId("node-fetch")).getByLabelText("1 problem")).toBeTruthy());
    expect(button(/1 problem/)).toBeTruthy();
    fireEvent.click(screen.getByText("Fetch order"));
    expect(screen.getByText("is not a valid URL")).toBeTruthy(); // on the field itself
  });
});

describe("publishing", () => {
  it("asks first, warns when the draft was never run in staging, and publishes", async () => {
    vi.mocked(publishDraft).mockResolvedValue({ id: "v", version: 2, created_at: "now", staging_verified: false, warnings: [] });
    const onPublished = vi.fn();
    mount({ draft: { ...META, has_unpublished_changes: true }, onPublished });
    fireEvent.click(button(/^Publish/));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Publish version 2?")).toBeTruthy();
    expect(within(dialog).getByText("Not verified in staging")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Publish v2/ }));
    await waitFor(() => expect(publishDraft).toHaveBeenCalledWith("wf", '"1"'));
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith(2));
    await waitFor(() => expect(status()).toMatch(/v2 live/));
  });

  it("has nothing to publish when the draft matches production", () => {
    mount();
    expect(button(/^Publish/).disabled).toBe(true);
  });
});

describe("conflicts", () => {
  it("explains a stale draft and lets you load the latest", async () => {
    vi.mocked(putDraft).mockRejectedValue(new ApiError(412, "changed"));
    const props = mount();
    fireEvent.click(screen.getByText("Fetch order"));
    fireEvent.change(screen.getByLabelText(/^URL/), { target: { value: "http://mine" } });
    fireEvent.click(button(/^Save/));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("This draft was changed elsewhere")).toBeTruthy();
    expect(status()).toMatch(/Unsaved changes/); // nothing was lost
    fireEvent.click(within(dialog).getByRole("button", { name: "Load latest" }));
    expect(props.onReload).toHaveBeenCalled();
  });
});

describe("read-only views", () => {
  it("production cannot be edited, saved or published, and offers a way back to the draft", () => {
    const props = mount({ view: "production" });
    expect(status()).toMatch(/Production · v1 is live. This view is read-only/);
    expect(button(/^Save/).disabled).toBe(true);
    expect(button(/^Publish/).disabled).toBe(true);
    expect(button(/Validate/).disabled).toBe(true);
    fireEvent.click(screen.getByText("Fetch order"));
    expect((screen.getByLabelText("Display name") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /delete step/i })).toBeNull();
    fireEvent.click(button("Edit in staging"));
    expect(props.onSwitchView).toHaveBeenCalledWith("staging");
  });

  it("a viewer sees the draft but cannot change it", () => {
    mount({ canEdit: false });
    expect(status()).toMatch(/view only/);
    expect(button(/^Save/).disabled).toBe(true);
    expect(screen.getByText(/read-only, so steps cannot be added/)).toBeTruthy();
  });
});

describe("dry run", () => {
  it("is a preview that never calls the API", () => {
    mount();
    expect(button(/Dry run$/)).toBeTruthy();
    expect(putDraft).not.toHaveBeenCalled();
  });
});
