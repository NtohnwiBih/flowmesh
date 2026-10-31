// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { fieldsFromSchema, type Config } from "@/lib/schema-form";
import { typeById } from "@/lib/test-helpers";
import { SchemaForm } from "./schema-form";

afterEach(cleanup);
const httpFields = fieldsFromSchema(typeById("http").config_schema);

function setup(props: Partial<React.ComponentProps<typeof SchemaForm>> = {}) {
  const onChange = vi.fn();
  render(<SchemaForm fields={httpFields} config={undefined} onChange={onChange} issues={[]} {...props} />);
  return onChange;
}

describe("SchemaForm with the real http schema", () => {
  it("renders a labelled control for every field, and marks the required one", () => {
    setup();
    expect(screen.getByLabelText(/^URL/)).toBeTruthy();
    expect(screen.getByLabelText("Method")).toBeTruthy();
    expect(screen.getByLabelText("Body")).toBeTruthy();
    expect(screen.getByText("*")).toBeTruthy();
  });

  it("reports edits as the whole new config", () => {
    const onChange = setup({ config: { method: "POST" } });
    fireEvent.change(screen.getByLabelText(/^URL/), { target: { value: "https://x/y" } });
    expect(onChange).toHaveBeenCalledWith({ method: "POST", url: "https://x/y" });
  });

  it("offers the schema default for an unset optional select, and clears back to it", () => {
    const onChange = setup({ config: { url: "u", method: "POST" } });
    const select = screen.getByLabelText("Method") as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(["Default (GET)", "GET", "POST", "PUT", "PATCH", "DELETE"]);
    expect(select.value).toBe("POST");
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ url: "u" }); // key removed, default applies
  });

  it("does not shout 'Required' at a field nobody has visited, but does after they leave it", () => {
    setup();
    expect(screen.queryByText("Required")).toBeNull();
    fireEvent.blur(screen.getByLabelText(/^URL/));
    expect(screen.getByText("Required")).toBeTruthy();
  });

  it("shows a server-reported problem straight away, linked to its field", () => {
    setup({ config: { url: "x" }, issues: [{ code: "invalid_config", node_id: "a", path: "config.url", message: "is not a valid URL" }] });
    const input = screen.getByLabelText(/^URL/);
    expect(screen.getByText("is not a valid URL")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps invalid JSON on screen without reporting it, then reports it once valid", () => {
    const onChange = setup({ config: { url: "u" } });
    const body = screen.getByLabelText("Body");
    fireEvent.change(body, { target: { value: "{oops" } });
    expect(screen.getByText(/Not valid JSON/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(body, { target: { value: '{"a":1}' } });
    expect(screen.queryByText(/Not valid JSON/)).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith({ url: "u", body: { a: 1 } });
  });

  it("disables everything when read-only", () => {
    setup({ disabled: true });
    expect((screen.getByLabelText(/^URL/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Method") as HTMLSelectElement).disabled).toBe(true);
  });

  it("says so when a step has no settings", () => {
    setup({ fields: fieldsFromSchema(typeById("webhook").config_schema) });
    expect(screen.getByText("This step has no settings.")).toBeTruthy();
  });
});

describe("other field kinds", () => {
  const fields = fieldsFromSchema({
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 5, title: "Limit" }, verbose: { type: "boolean", title: "Verbose" } },
  });

  // Behaves like the real editor: the new config is fed back in as a prop.
  function Harness({ spy }: { spy: (c: unknown) => void }) {
    const [config, setConfig] = useState<Config | undefined>(undefined);
    return <SchemaForm fields={fields} config={config} issues={[]} onChange={(c) => { spy(c); setConfig(c); }} />;
  }

  it("sends numbers as numbers, and clears the key when emptied", () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const input = screen.getByLabelText("Limit") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3" } });
    expect(spy).toHaveBeenLastCalledWith({ limit: 3 });
    expect(input.value).toBe("3");
    fireEvent.change(input, { target: { value: "" } });
    expect(spy).toHaveBeenLastCalledWith(undefined); // nothing left in the config
  });

  it("sends booleans as booleans, and remembers an explicit false", () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const toggle = screen.getByLabelText("Verbose");
    fireEvent.click(toggle);
    expect(spy).toHaveBeenLastCalledWith({ verbose: true });
    fireEvent.click(toggle);
    expect(spy).toHaveBeenLastCalledWith({ verbose: false }); // kept: false is a real choice, not "unset"
  });
});
