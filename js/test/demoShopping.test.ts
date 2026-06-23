import { describe, expect, it } from "vitest";
import { type ShoppingItem, toggleDone } from "../demo/shoppingStore";

const items: ShoppingItem[] = [
  { id: "milk", text: "Milk", done: false },
  { id: "eggs", text: "Eggs", done: true },
];

describe("demo shopping list", () => {
  it("flips only the targeted item's done flag", () => {
    const next = toggleDone(items, "milk");
    expect(next.find((i) => i.id === "milk")?.done).toBe(true);
    // Untouched items keep their state.
    expect(next.find((i) => i.id === "eggs")?.done).toBe(true);
  });

  it("toggles a done item back to undone", () => {
    expect(toggleDone(items, "eggs").find((i) => i.id === "eggs")?.done).toBe(
      false,
    );
  });

  it("does not mutate the input array", () => {
    toggleDone(items, "milk");
    expect(items.find((i) => i.id === "milk")?.done).toBe(false);
  });
});
