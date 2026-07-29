import { afterEach, describe, expect, it, vi } from "vitest";
import { BUDGETS, createCommitBudgetCheck } from "../src/budgets";
import { MemoryHost, Text, VStack } from "../src/index";
import { mountApp, resetApp } from "./helpers";

afterEach(() => {
  resetApp();
  vi.restoreAllMocks();
});

describe("createCommitBudgetCheck (hysteresis)", () => {
  const over = BUDGETS.maxCommitJSONBytes + 1;
  const under = 10;

  it("warns once per crossing, and again only after re-crossing", () => {
    const warn = vi.fn();
    const check = createCommitBudgetCheck(warn);

    check(over, 1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("maxCommitJSONBytes");

    // Still over: no second warning while the breach persists.
    check(over + 500, 1);
    expect(warn).toHaveBeenCalledTimes(1);

    // Back under: re-arms silently.
    check(under, 1);
    expect(warn).toHaveBeenCalledTimes(1);

    // Re-crossing warns again.
    check(over, 1);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("tracks the node and byte budgets independently", () => {
    const warn = vi.fn();
    const check = createCommitBudgetCheck(warn);

    // Both cross at once → two warnings.
    check(over, BUDGETS.maxNodes + 1);
    expect(warn).toHaveBeenCalledTimes(2);
    const messages = warn.mock.calls.map(([m]) => String(m));
    expect(messages.some((m) => m.includes("maxCommitJSONBytes"))).toBe(true);
    expect(messages.some((m) => m.includes("maxNodes"))).toBe(true);

    // Nodes recover while bytes stay over → nothing new; then only nodes
    // re-cross.
    check(over, under);
    expect(warn).toHaveBeenCalledTimes(2);
    check(over, BUDGETS.maxNodes + 1);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[2]?.[0]).toContain("maxNodes");
  });

  it("treats the exact limit as within budget", () => {
    const warn = vi.fn();
    const check = createCommitBudgetCheck(warn);
    check(BUDGETS.maxCommitJSONBytes, BUDGETS.maxNodes);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the documented numbers (docs/budgets-and-limits.md + BudgetPolicy.swift)", () => {
    expect(BUDGETS).toEqual({
      maxNodes: 1000,
      maxCommitJSONBytes: 262_144,
      maxWidgetRenderMs: 500,
      maxTransferFileBytes: 1_048_576,
    });
  });
});

describe("renderer wiring", () => {
  it("warns (once) when a committed tree crosses maxNodes, and still commits", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = new MemoryHost();
    // maxNodes+1 Text instances + the VStack root cross the budget.
    const items = Array.from({ length: BUDGETS.maxNodes + 1 }, (_, n) => (
      <Text key={n}>item</Text>
    ));
    mountApp(<VStack>{items}</VStack>, host);

    const nodeWarnings = warn.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes("maxNodes"));
    expect(nodeWarnings).toHaveLength(1);
    // WARN, not reject: the oversized commit still reached the host.
    expect(host.lastCommit?.root?.children).toHaveLength(BUDGETS.maxNodes + 1);
  });

  it("does not warn for a small tree", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = new MemoryHost();
    mountApp(<Text>small</Text>, host);
    expect(
      warn.mock.calls.some(([message]) => String(message).includes("budget")),
    ).toBe(false);
  });
});
