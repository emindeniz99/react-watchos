export interface ShoppingItem {
  id: string;
  text: string;
  done: boolean;
}

export interface ShoppingList {
  id: string;
  name: string;
  items: ShoppingItem[];
}

/**
 * Seed data for the shopping-lists demo. In-memory and mutable: ticking an
 * item persists for the session so it survives leaving and re-entering a list.
 */
export const shoppingLists: ShoppingList[] = [
  {
    id: "groceries",
    name: "Groceries",
    items: [
      { id: "milk", text: "Milk", done: false },
      { id: "eggs", text: "Eggs", done: true },
      { id: "bread", text: "Bread", done: false },
      { id: "coffee", text: "Coffee", done: false },
    ],
  },
  {
    id: "hardware",
    name: "Hardware",
    items: [
      { id: "screws", text: "Screws", done: false },
      { id: "glue", text: "Wood glue", done: false },
    ],
  },
];

export function findShoppingList(id: string): ShoppingList | undefined {
  return shoppingLists.find((list) => list.id === id);
}

/** Pure done/undone toggle, so the logic is unit-tested without a host. */
export function toggleDone(items: ShoppingItem[], id: string): ShoppingItem[] {
  return items.map((item) =>
    item.id === id ? { ...item, done: !item.done } : item,
  );
}
