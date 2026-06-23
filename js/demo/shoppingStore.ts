import { Storage } from "../src/index";

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

// App Group storage so the widget extension's fresh timeline render (a
// separate QuickJS process) reads the same lists the app last edited — and
// so edits survive relaunch. See hydrationStore for the same pattern.
const LISTS_KEY = "shopping.lists";
const FEATURED_KEY = "shopping.featuredListId";

/**
 * Cached snapshot. Hydrated from storage once at module load; every mutation
 * swaps this reference (and the touched list + items arrays) for fresh
 * identities AND writes through to storage. The cache is what getSnapshot
 * returns: a stable reference until the next mutation, as useSyncExternalStore
 * requires (re-reading storage would deserialize a new object each call and
 * loop forever). Mutating in place is invisible to the React Compiler.
 */
let lists: ShoppingList[] = Storage.get<ShoppingList[]>(LISTS_KEY) ?? seed;
let featuredListId: string | null = Storage.get<string>(FEATURED_KEY) ?? null;

const listeners = new Set<() => void>();
let nextId = 1;

function notify(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to store changes (the getSnapshot half is the getters below). */
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

/** The list chosen to appear as the watch-face complication, if any. */
export function getFeaturedListId(): string | null {
  return featuredListId;
}

/** Pure done/undone toggle, so the logic is unit-tested without a host. */
export function toggleDone(items: ShoppingItem[], id: string): ShoppingItem[] {
  return items.map((item) =>
    item.id === id ? { ...item, done: !item.done } : item,
  );
}

/** Replace the cached lists with a fresh identity, persist, and notify. */
function setLists(next: ShoppingList[]): void {
  lists = next;
  Storage.set(LISTS_KEY, lists);
  notify();
}

/** Immutable update of one list's items. */
function updateItems(
  listId: string,
  update: (items: ShoppingItem[]) => ShoppingItem[],
): void {
  const index = lists.findIndex((list) => list.id === listId);
  const list = lists[index];
  if (!list) return;
  const updated: ShoppingList = { ...list, items: update(list.items) };
  setLists(lists.map((current, i) => (i === index ? updated : current)));
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

/** Append a new list with the given name. No-op for a blank name. */
export function addList(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const list: ShoppingList = {
    id: `list-${Date.now()}-${nextId++}`,
    name: trimmed,
    items: [],
  };
  setLists([...lists, list]);
}

/** Append a new (not-done) item to a list. No-op for a blank text. */
export function addItem(listId: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  updateItems(listId, (items) => [
    ...items,
    { id: `item-${Date.now()}-${nextId++}`, text: trimmed, done: false },
  ]);
}

/** Choose (or clear, with null) the list shown as the complication. */
export function setFeaturedList(id: string | null): void {
  featuredListId = id;
  Storage.set(FEATURED_KEY, id);
  notify();
}
