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

const listeners = new Set<() => void>();

/** Subscribe to store changes (for useSyncExternalStore). */
export function subscribeShopping(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Toggle an item with an immutable update: it replaces the item, its list's
 * items array, AND the list object's identity in `shoppingLists`, then
 * notifies subscribers. The fresh identities are what let useSyncExternalStore
 * (and the React Compiler's auto-memoization) observe the change — mutating in
 * place is invisible to the compiler and renders stale rows.
 */
export function toggleShoppingItem(listId: string, itemId: string): void {
  const index = shoppingLists.findIndex((list) => list.id === listId);
  const list = shoppingLists[index];
  if (!list) return;
  shoppingLists[index] = { ...list, items: toggleDone(list.items, itemId) };
  for (const listener of listeners) listener();
}
