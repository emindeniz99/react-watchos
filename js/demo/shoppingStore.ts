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

const seed: ShoppingList[] = [
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

/**
 * Current snapshot of the shopping lists. In-memory and persists for the
 * session (ticks survive leaving and re-entering a list). Every mutation swaps
 * this reference — and the touched list + items arrays — for fresh identities,
 * so useSyncExternalStore and the React Compiler's auto-memoization observe the
 * change. Mutating in place is invisible to the compiler and renders stale rows.
 */
let lists: ShoppingList[] = seed;

const listeners = new Set<() => void>();

/** Subscribe to store changes (the getSnapshot half is the getter below). */
export function subscribeShopping(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current snapshot — a stable reference until the next mutation. */
export function getShoppingLists(): ShoppingList[] {
  return lists;
}

export function findShoppingList(id: string): ShoppingList | undefined {
  return lists.find((list) => list.id === id);
}

/** Pure done/undone toggle, so the logic is unit-tested without a host. */
export function toggleDone(items: ShoppingItem[], id: string): ShoppingItem[] {
  return items.map((item) =>
    item.id === id ? { ...item, done: !item.done } : item,
  );
}

/** Immutable update of one list's items, then notify subscribers. */
function updateItems(
  listId: string,
  update: (items: ShoppingItem[]) => ShoppingItem[],
): void {
  const index = lists.findIndex((list) => list.id === listId);
  const list = lists[index];
  if (!list) return;
  const updated: ShoppingList = { ...list, items: update(list.items) };
  lists = lists.map((current, i) => (i === index ? updated : current));
  for (const listener of listeners) listener();
}

/** Flip an item's done flag (used by tapping a row). */
export function toggleShoppingItem(listId: string, itemId: string): void {
  updateItems(listId, (items) => toggleDone(items, itemId));
}

/** Set an item's done flag explicitly (used by the directional swipe edges). */
export function setShoppingItemDone(
  listId: string,
  itemId: string,
  done: boolean,
): void {
  updateItems(listId, (items) =>
    items.map((item) => (item.id === itemId ? { ...item, done } : item)),
  );
}
