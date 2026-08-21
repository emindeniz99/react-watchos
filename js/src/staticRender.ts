import type { ReactNode } from "react";
import * as React from "react";
import type { SerializedNode } from "./host";
import {
  hasElementChild,
  RAW_TEXT_ERROR,
  type SerializableNode,
  serializeTree,
} from "./serialize";

/**
 * A reconciler-free renderer for ONE-SHOT static trees — the widget/timeline
 * path (`renderToTree` in widgets.ts).
 *
 * WHY this exists at all. Widget timelines used to be rendered by mounting a
 * real fiber tree on a `MemoryHost` + `WatchRoot`, running a full commit,
 * taking the one serialized node and throwing the tree away. That pulled
 * react-reconciler + scheduler into the WIDGET bundle: measured on this repo's
 * own minified bundles, react-reconciler 117,297 B + scheduler 3,697 B +
 * renderer.ts 5,314 B + reconcilerAdapter.ts 494 B out of a 153,362 B widget
 * bundle — ~83% of the bundle to render a static tree exactly once, with no
 * host, no events, no state updates and no second render to reconcile against.
 * The widget extension pays for that in its 16 MB JS heap under WidgetKit's
 * ~30 MB limit, on every timeline request.
 *
 * WHAT it is. A depth-first walk of the React ELEMENT tree straight into the
 * `SerializableNode` shape the reconciler's host instances already have, handed
 * to the SAME `serializeTree`/`serializeInstance` in serialize.ts. Nothing
 * about the wire is re-implemented here — only the tree building is. Two
 * details of the fiber path are load-bearing and are mirrored deliberately:
 *
 *  - **ids are assigned post-order.** react-reconciler creates a host instance
 *    in `completeWork`, i.e. after its children, so a tree's `id`s run
 *    deepest-leftmost first. The ids are on the wire (native event targeting
 *    reads them), so children are walked BEFORE the parent takes its id.
 *  - **`<Text>` folding** follows `hostConfig.shouldSetTextContent`: a Text
 *    whose children are all scalars creates no child nodes (the text folds into
 *    `props.text` at serialization); a Text with an element child renders every
 *    segment, raw strings included, as a child node.
 *
 * Prior art (CLAUDE.md rule 3): the recursive element walk with
 * Fragment/memo/forwardRef/context unwrapping and a minimal synchronous hook
 * dispatcher is the shape `preact-render-to-string` (`_renderToString`) and
 * `react-shallow-renderer` (`ReactShallowRenderer._createDispatcher`, which
 * likewise swaps React's internal `H` dispatcher slot for the duration of a
 * render) both use. Neither could be adopted directly: preact-render-to-string
 * renders Preact vnodes to an HTML string, and react-shallow-renderer stops at
 * one level and is React-DOM-flavoured — we need the full host tree, in our own
 * node shape. What is borrowed is the dispatcher-swap technique and the hook
 * subset that is meaningful without a fiber to store state on.
 *
 * WHAT IT IS NOT. There is no fiber, no scheduler, no commit and no second
 * render, so a widget component is a PURE function of its props and the stores
 * it reads: effects never run, state setters have nothing to re-render, and
 * Suspense/lazy have nothing to retry. Those throw loudly rather than silently
 * rendering something different from what a fiber render would have produced.
 */

// React's element/type tags. Read as `Symbol.for(...)` rather than imported so
// this module never depends on a react internal export beyond the dispatcher
// slot below; the registry is global, so these are the same symbols React uses.
const REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element");
const REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");
const REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode");
const REACT_PROFILER_TYPE = Symbol.for("react.profiler");
const REACT_CONSUMER_TYPE = Symbol.for("react.consumer");
const REACT_CONTEXT_TYPE = Symbol.for("react.context");
const REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
const REACT_MEMO_TYPE = Symbol.for("react.memo");
/** What React fills a fresh `useMemoCache` slot with — the React Compiler's
 *  generated code compares against exactly this symbol to decide "not cached
 *  yet". A one-shot render always starts empty, so every slot recomputes. */
const REACT_MEMO_CACHE_SENTINEL = Symbol.for("react.memo_cache_sentinel");

/** A React element, as the JSX runtime builds it. */
interface StaticElement {
  type: unknown;
  props: Record<string, unknown>;
}

/** A context object (React 19: the context IS its own Provider). */
interface StaticContext {
  _currentValue: unknown;
}

/** Per-walk mutable state. Passed explicitly rather than kept at module scope
 *  so a nested render (a store getter that renders) can't share a counter. */
interface WalkState {
  nextId: number;
}

/**
 * The context values currently provided, innermost last. React keeps this on
 * the fiber stack; a Map of stacks is the equivalent for a plain recursion, and
 * unlike React-DOM's server renderer it does NOT mutate `context._currentValue`
 * — so a throw mid-walk can't leave the app's contexts corrupted.
 */
const contextStacks = new Map<StaticContext, unknown[]>();

function readContext(context: StaticContext): unknown {
  const stack = contextStacks.get(context);
  return stack && stack.length > 0
    ? stack[stack.length - 1]
    : context._currentValue;
}

/** A `useId` counter, reset per walk so the same tree always yields the same ids. */
let idCounter = 0;

function noop(): void {}

/**
 * Every state-setter this dispatcher hands out. A widget tree is rendered once
 * and serialized; there is no fiber to schedule an update on and no second
 * render to produce, so a setter CALLED during the render would silently drop
 * the update. Fail loud instead (rule 12). Passing a setter as a prop is fine —
 * function props serialize to the literal `true` and are never invoked here.
 */
function noStateUpdate(): never {
  throw new Error(
    "A widget component tried to update state during render. Widget trees are " +
      "rendered once, without the React reconciler, so there is nothing to " +
      "re-render: a widget render must be a pure function of its props and the " +
      "stores it reads.",
  );
}

/**
 * The subset of React's hook dispatcher that has a defined meaning in a
 * single synchronous render with no fiber behind it. Anything that would need
 * a second render (state, transitions) returns its initial value and a setter
 * that throws; anything memoizing across renders simply recomputes, which is
 * always correct for a render that happens exactly once.
 *
 * `useMemoCache` is not optional decoration: the build preset enables the React
 * Compiler, so any consumer component in a widget tree is compiled to
 * `react/compiler-runtime`'s `c(n)` — which is a straight call into this slot.
 * Without it a compiled widget component throws on its first line.
 */
const dispatcher: Record<string, unknown> = {
  readContext,
  useContext: readContext,
  useState: (initial: unknown) => [resolveLazy(initial), noStateUpdate],
  useReducer: (
    _reducer: unknown,
    initialArg: unknown,
    init?: (arg: unknown) => unknown,
  ) => [init ? init(initialArg) : initialArg, noStateUpdate],
  useMemo: (create: () => unknown) => create(),
  useCallback: (callback: unknown) => callback,
  useRef: (initial: unknown) => ({ current: initial }),
  // Effects of every flavour are scheduled after a commit. Nothing commits.
  useEffect: noop,
  useLayoutEffect: noop,
  useInsertionEffect: noop,
  useImperativeHandle: noop,
  useDebugValue: noop,
  useEffectEvent: (callback: unknown) => callback,
  useId: () => `:r${idCounter++}:`,
  // The store is read exactly once; there is nothing to subscribe to.
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
    getSnapshot(),
  useDeferredValue: (value: unknown) => value,
  useTransition: () => [false, (scope: () => void) => scope()],
  useOptimistic: (passthrough: unknown) => [passthrough, noStateUpdate],
  useActionState: (_action: unknown, initialState: unknown) => [
    initialState,
    noStateUpdate,
    false,
  ],
  useFormState: (_action: unknown, initialState: unknown) => [
    initialState,
    noStateUpdate,
    false,
  ],
  useCacheRefresh: () => noop,
  useHostTransitionStatus: () => null,
  useMemoCache: (size: number) =>
    new Array<unknown>(size).fill(REACT_MEMO_CACHE_SENTINEL),
};

/** React's shared-internals object; `H` is the live hook dispatcher slot.
 *  @types/react does not declare this export, hence the cast — the same
 *  internals door react-shallow-renderer uses, and the only one there is. */
const reactInternals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
      H: unknown;
    };
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

function resolveLazy(initial: unknown): unknown {
  return typeof initial === "function" ? (initial as () => unknown)() : initial;
}

/** A readable name for an element type, for the unsupported-feature errors. */
function describeType(type: unknown): string {
  if (typeof type === "symbol") return `<${type.description ?? "unknown"}>`;
  if (typeof type === "function") return `<${type.name || "anonymous"}>`;
  if (typeof type === "object" && type !== null) {
    const tag = (type as { $$typeof?: unknown }).$$typeof;
    if (typeof tag === "symbol") return `<${tag.description ?? "unknown"}>`;
  }
  return String(type);
}

function unsupported(type: unknown): Error {
  return new Error(
    `${describeType(type)} is not supported in a widget render. Widget trees ` +
      "render WITHOUT the React reconciler (see docs/ui-guide.md, “Widget " +
      "components render without the reconciler”), so Suspense, lazy(), " +
      "portals and effects have nothing to drive them: a widget render must be " +
      "a pure function of its props and the stores it reads.",
  );
}

/**
 * A raw scalar child. React coerces it to a string and creates a host TEXT
 * fiber for it — legal only under a <Text> (`assertTextParent` /
 * `appendChildToContainer` in renderer.ts fail loud on anything else, and so
 * does this). An EMPTY string creates no fiber at all in React, so it creates
 * no node here either.
 */
function appendRawText(
  out: SerializableNode[],
  text: string | number | bigint,
  state: WalkState,
  parentType: string | null,
): void {
  if (text === "") return;
  if (parentType !== "Text") {
    throw new Error(RAW_TEXT_ERROR);
  }
  out.push({
    id: state.nextId++,
    type: "Text",
    props: { children: String(text) },
    children: [],
  });
}

/** One host node (a string element type) plus, unless its children fold into
 *  `props.text`, its whole subtree. */
function appendHost(
  out: SerializableNode[],
  type: string,
  props: Record<string, unknown>,
  state: WalkState,
): void {
  const children: SerializableNode[] = [];
  // hostConfig.shouldSetTextContent, mirrored: scalar-only <Text> children fold
  // into props.text and produce NO child nodes; every other case renders them.
  if (type !== "Text" || hasElementChild(props.children)) {
    appendNode(children, props.children, state, type);
  }
  // The id comes AFTER the subtree: react-reconciler numbers host instances in
  // completeWork (post-order), and those ids are on the wire.
  out.push({ id: state.nextId++, type, props, children });
}

/** Calls a function component, or a class component's `render()`. */
function renderComponent(
  type: (props: Record<string, unknown>) => unknown,
  props: Record<string, unknown>,
): unknown {
  const prototype = type.prototype as
    | { isReactComponent?: unknown }
    | undefined;
  if (prototype?.isReactComponent) {
    // Class components render, and nothing more: no lifecycle, no setState, no
    // error boundary (there is no commit to catch, and renderWidgets already
    // isolates a throwing widget per kind). Field initializers run in the
    // constructor, so `this.state = {...}` is in place for render().
    const ClassComponent = type as unknown as new (
      props: Record<string, unknown>,
    ) => { props: Record<string, unknown>; render: () => unknown };
    const instance = new ClassComponent(props);
    instance.props = props;
    return instance.render();
  }
  return type(props);
}

/** memo / forwardRef / context Provider / context Consumer. */
function appendExotic(
  out: SerializableNode[],
  type: object,
  props: Record<string, unknown>,
  state: WalkState,
  parentType: string | null,
): void {
  const tag = (type as { $$typeof?: unknown }).$$typeof;
  if (tag === REACT_MEMO_TYPE) {
    // memo caches across renders; with exactly one render there is nothing to
    // compare against, so unwrapping it IS its full behaviour here.
    appendType(out, (type as { type: unknown }).type, props, state, parentType);
    return;
  }
  if (tag === REACT_FORWARD_REF_TYPE) {
    // A one-shot walk exposes no host instances, so the ref stays null.
    const { render } = type as {
      render: (props: Record<string, unknown>, ref: unknown) => unknown;
    };
    appendNode(out, render(props, null), state, parentType);
    return;
  }
  if (tag === REACT_CONTEXT_TYPE) {
    appendProvider(out, type as StaticContext, props, state, parentType);
    return;
  }
  if (tag === REACT_CONSUMER_TYPE) {
    const render = props.children;
    if (typeof render !== "function") {
      throw new Error("A <Context.Consumer> needs a function as its child");
    }
    const context = (type as { _context: StaticContext })._context;
    appendNode(out, render(readContext(context)), state, parentType);
    return;
  }
  throw unsupported(type);
}

function appendProvider(
  out: SerializableNode[],
  context: StaticContext,
  props: Record<string, unknown>,
  state: WalkState,
  parentType: string | null,
): void {
  let stack = contextStacks.get(context);
  if (!stack) {
    stack = [];
    contextStacks.set(context, stack);
  }
  stack.push(props.value);
  try {
    appendNode(out, props.children, state, parentType);
  } finally {
    stack.pop();
  }
}

/** Dispatch on an element's `type` (also the recursion point for memo). */
function appendType(
  out: SerializableNode[],
  type: unknown,
  props: Record<string, unknown>,
  state: WalkState,
  parentType: string | null,
): void {
  if (typeof type === "string") {
    appendHost(out, type, props, state);
    return;
  }
  if (typeof type === "function") {
    const rendered = renderComponent(
      type as (props: Record<string, unknown>) => unknown,
      props,
    );
    appendNode(out, rendered, state, parentType);
    return;
  }
  // Fragment/StrictMode/Profiler add depth but no node, and no behaviour a
  // one-shot render can observe.
  if (
    type === REACT_FRAGMENT_TYPE ||
    type === REACT_STRICT_MODE_TYPE ||
    type === REACT_PROFILER_TYPE
  ) {
    appendNode(out, props.children, state, parentType);
    return;
  }
  if (typeof type === "object" && type !== null) {
    appendExotic(out, type, props, state, parentType);
    return;
  }
  throw unsupported(type);
}

/** Walks any renderable child (React's `reconcileChildFibers` equivalent). */
function appendNode(
  out: SerializableNode[],
  node: unknown,
  state: WalkState,
  parentType: string | null,
): void {
  // null/undefined/booleans render nothing — the `{cond && <X/>}` idiom.
  if (node == null || typeof node === "boolean") return;
  if (
    typeof node === "string" ||
    typeof node === "number" ||
    typeof node === "bigint"
  ) {
    appendRawText(out, node, state, parentType);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) appendNode(out, child, state, parentType);
    return;
  }
  if (typeof node !== "object") throw unsupported(node);
  const tag = (node as { $$typeof?: unknown }).$$typeof;
  if (tag === REACT_ELEMENT_TYPE) {
    const element = node as unknown as StaticElement;
    appendType(out, element.type, element.props, state, parentType);
    return;
  }
  // A portal, a lazy() payload or any other tagged non-element: named loudly.
  if (typeof tag === "symbol") throw unsupported(node);
  const iterator = (node as Iterable<unknown>)[Symbol.iterator];
  if (typeof iterator === "function") {
    for (const child of node as Iterable<unknown>) {
      appendNode(out, child, state, parentType);
    }
    return;
  }
  throw new Error(
    "Objects are not valid as a React child — got " +
      `${Object.prototype.toString.call(node)}. Render a <Text> with a string ` +
      "instead.",
  );
}

/**
 * One-shot render: element in, serialized tree out. No host, no reconciler, no
 * events — see this module's header for what that costs and what it buys.
 *
 * The single-root rule and every byte of the wire mapping come from
 * `serializeTree` in serialize.ts, shared verbatim with the app's fiber path.
 */
export function renderStatic(element: ReactNode): SerializedNode | null {
  const children: SerializableNode[] = [];
  const previousDispatcher = reactInternals.H;
  reactInternals.H = dispatcher;
  idCounter = 0;
  try {
    appendNode(children, element, { nextId: 1 }, null);
  } finally {
    reactInternals.H = previousDispatcher;
    // A throw mid-walk leaves provider frames on the stacks; drop them so the
    // next render can't read a value from a tree that never finished.
    contextStacks.clear();
  }
  return serializeTree({ children, lastSeq: 0 }).root;
}
