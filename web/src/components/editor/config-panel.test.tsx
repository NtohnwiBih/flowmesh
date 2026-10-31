// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { NodeData } from "@/lib/definition";
import { typeById } from "@/lib/test-helpers";
import { ConfigPanel } from "./config-panel";

afterEach(cleanup);

const data = (over: Partial<NodeData> = {}): NodeData => ({
  label: "Fetch order", description: "", kind: "HTTP Request", icon: "http", nodeType: "http", ...over,
});

function setup(over: Partial<React.ComponentProps<typeof ConfigPanel>> = {}) {
  const h = { onClose: vi.fn(), onRename: vi.fn(), onConfig: vi.fn(), onRetry: vi.fn(), onDelete: vi.fn() };
  render(<ConfigPanel id="fetch_order" data={data()} nodeType={typeById("http")} issues={[]} upstream={[]} readOnly={false} {...h} {...over} />);
  return h;
}

describe("ConfigPanel", () => {
  it("shows the name and the stable id, and renames without touching the id", () => {
    const h = setup();
    expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("Fetch order");
    expect(screen.getByText("fetch_order")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Get the order" } });
    expect(h.onRename).toHaveBeenCalledWith("Get the order");
  });

  it("turns retries on with sensible defaults and off again", () => {
    const h = setup();
    fireEvent.click(screen.getByRole("switch", { name: /retry on failure/i }));
    expect(h.onRetry).toHaveBeenCalledWith({ max_attempts: 3, backoff_seconds: 5 });
    cleanup();
    const h2 = setup({ data: data({ retry: { max_attempts: 4, backoff_seconds: 2 } }) });
    expect(screen.getByText("Up to 4 attempts")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /retry on failure/i }));
    expect(h2.onRetry).toHaveBeenCalledWith(undefined);
  });

  it("only accepts retry values the API accepts", () => {
    const h = setup({ data: data({ retry: { max_attempts: 3, backoff_seconds: 5 } }) });
    fireEvent.change(screen.getByLabelText("Max attempts"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Wait (seconds)"), { target: { value: "-1" } });
    expect(h.onRetry).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Max attempts"), { target: { value: "5" } });
    expect(h.onRetry).toHaveBeenCalledWith({ max_attempts: 5, backoff_seconds: 5 });
  });

  it("explains a trigger instead of offering retries or upstream data", () => {
    setup({ id: "hook", data: data({ nodeType: "webhook", label: "Order webhook" }), nodeType: typeById("webhook") });
    expect(screen.getByText("{{ nodes.hook.body }}")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /retry/i })).toBeNull();
  });

  it("warns about steps that cannot be published, and hides their form", () => {
    setup({ data: data({ nodeType: "condition" }), nodeType: typeById("condition") });
    expect(screen.getByText(/is not available yet/)).toBeTruthy();
    expect(screen.queryByLabelText("Method")).toBeNull();
    cleanup();
    setup({ data: data({ nodeType: "mystery" }), nodeType: undefined });
    expect(screen.getByRole("alert").textContent).toMatch(/does not know the step type/);
  });

  it("lists problems with the step itself", () => {
    setup({ issues: [{ code: "invalid_config", node_id: "fetch_order", path: "config", message: "'url' is a required property" }] });
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("'url' is a required property")).toBeTruthy();
  });

  it("copies a reference to upstream data", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup({ upstream: [{ id: "hook", label: "Order webhook" }] });
    fireEvent.click(screen.getByText("{{ nodes.hook }}"));
    expect(writeText).toHaveBeenCalledWith("{{ nodes.hook }}");
  });

  it("deletes and closes", () => {
    const h = setup();
    fireEvent.click(screen.getByRole("button", { name: /delete step/i }));
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(h.onDelete).toHaveBeenCalled();
    expect(h.onClose).toHaveBeenCalled();
  });

  it("is fully read-only when asked", () => {
    setup({ readOnly: true });
    expect(screen.queryByRole("button", { name: /delete step/i })).toBeNull();
    expect((screen.getByLabelText("Display name") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("switch", { name: /retry on failure/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
