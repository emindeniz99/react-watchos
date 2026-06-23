import { describe, expect, it } from "vitest";
import {
  findShoppingList,
  getShoppingLists,
  type ShoppingItem,
  setShoppingItemDone,
  subscribeShopping,
  toggleDone,
  toggleShoppingItem,
} from "../demo/shoppingStore";

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

describe("toggleShoppingItem store update", () => {
  // The React Compiler reuses cached row JSX when an object's identity is
  // unchanged, so a tap that mutated items in place rendered stale rows. The
  // store must REPLACE the list object identity (not mutate it) for the
  // toggle to be visible. These tests guard that invariant.
  it("replaces the list object's identity so memoized renders refresh", () => {
    const before = findShoppingList("groceries");
    toggleShoppingItem("groceries", "milk");
    const after = findShoppingList("groceries");
    expect(after).not.toBe(before);
    expect(after?.items).not.toBe(before?.items);
    expect(after?.items.find((i) => i.id === "milk")?.done).toBe(
      !before?.items.find((i) => i.id === "milk")?.done,
    );
  });

  it("notifies subscribers on toggle", () => {
    let calls = 0;
    const unsubscribe = subscribeShopping(() => {
      calls += 1;
    });
    toggleShoppingItem("groceries", "bread");
    unsubscribe();
    toggleShoppingItem("groceries", "bread");
    expect(calls).toBe(1);
  });

  it("swaps the top-level snapshot identity so list-of-lists refreshes", () => {
    const before = getShoppingLists();
    toggleShoppingItem("groceries", "coffee");
    expect(getShoppingLists()).not.toBe(before);
  });

  it("sets an explicit done flag (directional swipe edges)", () => {
    setShoppingItemDone("hardware", "screws", true);
    expect(
      findShoppingList("hardware")?.items.find((i) => i.id === "screws")?.done,
    ).toBe(true);
    // Idempotent: setting the same value again keeps it.
    setShoppingItemDone("hardware", "screws", true);
    expect(
      findShoppingList("hardware")?.items.find((i) => i.id === "screws")?.done,
    ).toBe(true);
    setShoppingItemDone("hardware", "screws", false);
    expect(
      findShoppingList("hardware")?.items.find((i) => i.id === "screws")?.done,
    ).toBe(false);
  });

  it("ignores an unknown list id without notifying", () => {
    const snapshot = getShoppingLists();
    let calls = 0;
    const unsubscribe = subscribeShopping(() => {
      calls += 1;
    });
    toggleShoppingItem("does-not-exist", "milk");
    unsubscribe();
    expect(calls).toBe(0);
    expect(getShoppingLists()).toBe(snapshot);
  });
});
