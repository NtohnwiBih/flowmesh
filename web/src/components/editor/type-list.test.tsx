// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { catalog } from "@/lib/test-helpers";
import { Palette } from "./palette";
import { TypeList } from "./type-list";

afterEach(cleanup);

describe("TypeList", () => {
  it("groups the catalog by category", () => {
    render(<TypeList types={catalog} onPick={() => {}} />);
    for (const heading of ["Triggers", "Core", "AI"]) expect(screen.getByText(heading)).toBeTruthy();
  });

  it("picks an available step on click", () => {
    const onPick = vi.fn();
    render(<TypeList types={catalog} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /HTTP Request/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "http" }));
  });

  it("shows unavailable steps as disabled 'Soon', with the reason on hover, and never picks them", () => {
    const onPick = vi.fn();
    render(<TypeList types={catalog} onPick={onPick} draggable />);
    const condition = screen.getByRole("button", { name: /Condition/ }) as HTMLButtonElement;
    expect(condition.disabled).toBe(true);
    expect(condition.draggable).toBe(false);
    expect(condition.title).toMatch(/coming soon/);
    fireEvent.click(condition);
    expect(onPick).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /HTTP Request/ }) as HTMLButtonElement).draggable).toBe(true);
  });

  it("filters by search, and hides triggers when nothing may connect into them", () => {
    const { rerender } = render(<TypeList types={catalog} query="http" onPick={() => {}} />);
    expect(screen.queryByRole("button", { name: /Webhook/ })).toBeNull();
    expect(screen.getByRole("button", { name: /HTTP Request/ })).toBeTruthy();
    rerender(<TypeList types={catalog} onPick={() => {}} hideTriggers />);
    expect(screen.queryByRole("button", { name: /Webhook/ })).toBeNull();
    expect(screen.getByRole("button", { name: /HTTP Request/ })).toBeTruthy();
    rerender(<TypeList types={catalog} query="zzzz" onPick={() => {}} />);
    expect(screen.getByText("No matching steps")).toBeTruthy();
  });
});

describe("Palette", () => {
  it("is read-only when asked, and always shows integrations as coming soon", () => {
    render(<Palette types={catalog} onAdd={() => {}} readOnly />);
    expect(screen.getByText(/read-only/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /HTTP Request/ })).toBeNull();
    expect(screen.getByTitle(/integrations arrive/i).getAttribute("aria-disabled")).toBe("true");
  });
});
