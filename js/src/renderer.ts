import { createContext, type ReactNode } from "react";
import Reconciler from "react-reconciler";
import {
  ConcurrentRoot,
  DefaultEventPriority,
  DiscreteEventPriority,
  NoEventPriority,
} from "react-reconciler/constants";
import { createCommitBudgetCheck } from "./budgets";
import { dispatchToInstance, pathChangeAccepted } from "./events";
import type { HostBridge, SerializedTree, WatchEvent } from "./host";
import { serializeTree, textContent } from "./serialize";

/**
 * Structured result of a native event dispatch (ARCH-09), returned to Swift as
 * a JSON string by `__dispatchEvent` so navigation can be a request/confirm
 * transaction instead of a fire-and-forget.
 *
 *  - `handled` — a handler prop existed and ran (the old boolean).
 *  - `accepted` — the *proposal* took effect. For `pathChange` this is a
 *    post-flush comparison of the stack's committed path against the proposed
 *    one; for every other event it mirrors `handled`.
 *  - `reason` — why `accepted` is false, when it is.
 *
 * A thrown handler produces NO result (the exception propagates out of
 * `__dispatchEvent`); Swift maps that, like a missing global, to a rollback.
 */
// TODO(codegen): fold into schema.ts when codegen is runnable.
export interface DispatchResult {
  handled: boolean;
  accepted: boolean;
  reason?: string;
}

export interface Instance {
  id: number;
  type: string;
  props: Record<string, unknown>;
  children: Instance[];
  container: Container;
  /** True for a raw text segment React created inside a rich <Text> — only
   *  ever legal as a Text child (guarded at every attach point). */
  rawText?: boolean;
}

export interface Container {
  children: Instance[];
  instances: Map<number, Instance>;
  nextId: number;
  /** Highest event seq processed; acked on every commit (tree.seq). */
  lastSeq: number;
  /** True when a mutation since the last serialize changed what the wire
   *  would carry (NF-21) — lets onCommit skip the O(tree) serialize +
   *  stringify for effect-only or value-identical commits entirely. */
  dirty: boolean;
  onCommit: () => void;
}

function removeFrom(list: Instance[], child: Instance): void {
  const index = list.indexOf(child);
  if (index >= 0) list.splice(index, 1);
}

function insertInto(list: Instance[], child: Instance, before: Instance): void {
  removeFrom(list, child);
  const index = list.indexOf(before);
  list.splice(index < 0 ? list.length : index, 0, child);
}

/** A React element child (vs a scalar) — the rich-text trigger. */
function hasElementChild(children: unknown): boolean {
  if (Array.isArray(children)) return children.some(hasElementChild);
  return typeof children === "object" && children !== null;
}

/** Raw text segments are only legal under a <Text> parent (fail loud). */
function assertTextParent(parent: Instance, child: Instance): void {
  if (child.rawText && parent.type !== "Text") {
    throw new Error("Raw text must be wrapped in a <Text> element");
  }
}

/**
 * Whether two props objects serialize to the same wire bytes (NF-21):
 * `children` is structural (folded to `text` only for Text), functions
 * collapse to `true`, `undefined` values are omitted. Non-scalar values
 * compare by identity — a fresh array/object counts as changed
 * (conservative: never skips a real change, may serialize needlessly).
 */
function wirePropsEqual(
  type: string,
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  if (a !== b) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key === "children") continue;
      const av = typeof a[key] === "function" ? true : a[key];
      const bv = typeof b[key] === "function" ? true : b[key];
      if (av === undefined && bv === undefined) continue;
      if (!Object.is(av, bv)) return false;
    }
  }
  if (type === "Text")
    return textContent(a.children) === textContent(b.children);
  return true;
}

let currentUpdatePriority: number = NoEventPriority;

const emptyContext = {};

const hostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  supportsMicrotasks: true,
  supportsResources: false,
  supportsSingletons: false,
  supportsTestSelectors: false,
  isPrimaryRenderer: true,
  warnsIfNotActing: false,
  noTimeout: -1 as const,
  rendererVersion: "0.1.0",
  rendererPackageName: "react-watchos",
  extraDevToolsConfig: null,

  // A stable non-null host context. Returning null breaks Suspense:
  // React's context stack rejects null when crossing a Suspense boundary
  // ("Expected host context to exist").
  getRootHostContext: () => emptyContext,
  getChildHostContext: (parentContext: unknown) => parentContext,
  getPublicInstance: (instance: Instance) => instance,
  prepareForCommit: () => null,
  resetAfterCommit(container: Container) {
    container.onCommit();
  },
  preparePortalMount() {},
  scheduleTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
  cancelTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  scheduleMicrotask: (fn: () => void) => queueMicrotask(fn),

  createInstance(
    type: string,
    props: Record<string, unknown>,
    rootContainer: Container,
  ): Instance {
    const instance: Instance = {
      id: rootContainer.nextId++,
      type,
      props,
      children: [],
      container: rootContainer,
    };
    rootContainer.instances.set(instance.id, instance);
    return instance;
  },
  // Rich text: a raw string inside a mixed <Text> becomes a Text segment
  // instance. It is only legal under a Text parent — enforced at the attach
  // points below, where the parent is known (createTextInstance isn't told).
  createTextInstance(text: string, rootContainer: Container): Instance {
    const instance: Instance = {
      id: rootContainer.nextId++,
      type: "Text",
      props: { children: text },
      children: [],
      container: rootContainer,
      rawText: true,
    };
    rootContainer.instances.set(instance.id, instance);
    return instance;
  },
  // Text folds its string children into props.text at serialization — UNLESS
  // an element child is present (rich text), when React must create child
  // fibers so each <Text> segment carries its own style.
  shouldSetTextContent: (type: string, props: Record<string, unknown>) =>
    type === "Text" && !hasElementChild(props.children),
  appendInitialChild: (parent: Instance, child: Instance) => {
    assertTextParent(parent, child);
    parent.children.push(child);
    parent.container.dirty = true;
  },
  finalizeInitialChildren: () => false,
  commitMount() {},
  commitUpdate(
    instance: Instance,
    type: string,
    oldProps: Record<string, unknown>,
    newProps: Record<string, unknown>,
  ) {
    // React flags an Update whenever the props OBJECT identity changes, so
    // this fires on every re-render of the node. Only wire-visible value
    // changes make the commit worth serializing (NF-21).
    if (!wirePropsEqual(type, oldProps, newProps)) {
      instance.container.dirty = true;
    }
    instance.props = newProps;
  },
  commitTextUpdate(textInstance: Instance, _old: string, next: string) {
    textInstance.props = { children: next };
    textInstance.container.dirty = true;
  },
  resetTextContent() {},
  appendChild: (parent: Instance, child: Instance) => {
    assertTextParent(parent, child);
    // Move semantics: react-reconciler reuses appendChild to reorder a keyed
    // child to the LAST position (getHostSibling returns null) with no preceding
    // removeChild, so a plain push would duplicate it — remove any existing
    // occurrence first, mirroring insertInto.
    removeFrom(parent.children, child);
    parent.children.push(child);
    parent.container.dirty = true;
  },
  appendChildToContainer: (container: Container, child: Instance) => {
    if (child.rawText) {
      throw new Error("Raw text must be wrapped in a <Text> element");
    }
    removeFrom(container.children, child);
    container.children.push(child);
    container.dirty = true;
  },
  insertBefore: (parent: Instance, child: Instance, before: Instance) => {
    assertTextParent(parent, child);
    insertInto(parent.children, child, before);
    parent.container.dirty = true;
  },
  insertInContainerBefore: (
    container: Container,
    child: Instance,
    before: Instance,
  ) => {
    insertInto(container.children, child, before);
    container.dirty = true;
  },
  removeChild(parent: Instance, child: Instance) {
    removeFrom(parent.children, child);
    parent.container.dirty = true;
  },
  removeChildFromContainer(container: Container, child: Instance) {
    removeFrom(container.children, child);
    container.dirty = true;
  },
  clearContainer(container: Container) {
    container.children = [];
    container.dirty = true;
  },
  // React calls this for every deleted instance, so the event-target map
  // cleanup lives here rather than in removeChild*.
  detachDeletedInstance(instance: Instance) {
    instance.container.instances.delete(instance.id);
  },
  hideInstance() {},
  unhideInstance() {},
  hideTextInstance() {},
  unhideTextInstance() {},

  setCurrentUpdatePriority(priority: number) {
    currentUpdatePriority = priority;
  },
  getCurrentUpdatePriority: () => currentUpdatePriority,
  resolveUpdatePriority: () =>
    currentUpdatePriority !== NoEventPriority
      ? currentUpdatePriority
      : DefaultEventPriority,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: () => {},
  requestPostPaintCallback() {},
  maySuspendCommit: () => false,
  maySuspendCommitOnUpdate: () => false,
  preloadInstance: () => true,
  startSuspendingCommit() {},
  suspendInstance() {},
  suspendOnActiveViewTransition: () => false,
  waitForCommitToBeReady: () => null,
  NotPendingTransition: null,
  HostTransitionContext: createContext(null),
  resetFormInstance() {},
  bindToConsole: (method: string, args: unknown[]) => () => {
    const fn = (console as unknown as Record<string, unknown>)[method];
    if (typeof fn === "function") fn.apply(console, args);
  },
};

// The 0.32 typings predate this host-config revision; the shape above is
// derived from what react-reconciler@0.33 actually reads.
const reconciler = Reconciler(hostConfig as never) as unknown as {
  createContainer(...args: unknown[]): unknown;
  updateContainerSync(
    element: ReactNode | null,
    root: unknown,
    parentComponent?: unknown,
    callback?: (() => void) | null,
  ): void;
  flushSyncWork(): void;
  flushPassiveEffects(): boolean;
  defaultOnUncaughtError(error: unknown): void;
  defaultOnCaughtError(error: unknown): void;
  defaultOnRecoverableError(error: unknown): void;
  injectIntoDevTools(config: unknown): boolean;
};

// Register with React DevTools if a backend hook is present (e.g.
// react-devtools-core connected over the dev server). Inert otherwise.
// QuickJS has no `process`; the build preset defines process.env.NODE_ENV, but
// guard so a consumer who bundles without it still works (defaults production).
const __devBuild =
  typeof process !== "undefined" && process.env.NODE_ENV !== "production";
try {
  reconciler.injectIntoDevTools({
    bundleType: __devBuild ? 1 : 0,
    version: "19.2.0",
    rendererPackageName: "react-watchos",
    findFiberByHostInstance: () => null,
  });
} catch {
  // No DevTools hook — fine.
}

export class WatchRoot {
  private container: Container;
  private root: unknown;
  private uncaughtError: unknown = null;
  private commitCount = 0;
  private lastCommitJson: string | null = null;
  private lastCommittedSeq = 0;
  /** ARCH-13 operating budgets: warns (once per crossing — hysteresis) when
   *  a commit's payload length or live node count outgrows its tripwire.
   *  Per-root state, so parallel roots (tests) can't share a crossing. */
  private checkCommitBudgets = createCommitBudgetCheck();

  constructor(host: HostBridge) {
    const container: Container = {
      children: [],
      instances: new Map(),
      nextId: 1,
      lastSeq: 0,
      dirty: false,
      onCommit: () => {
        // NF-21: a commit with no wire-visible mutation (effect-only commit,
        // or prop updates whose values are identical — e.g. a sensor reading
        // that rounds to the same displayed string) skips the O(tree)
        // serialize + stringify entirely. A seq advance must still be acked
        // (CX-010), so it forces the serialize even on a clean tree.
        if (
          !container.dirty &&
          this.lastCommitJson !== null &&
          container.lastSeq === this.lastCommittedSeq
        ) {
          return;
        }
        let tree: SerializedTree;
        try {
          tree = serializeTree(container);
        } catch (error) {
          // onCommit runs inside React's commit phase (resetAfterCommit);
          // throwing here unwinds the reconciler's module-level commit state
          // and corrupts EVERY later root in the runtime (NF-06). Route the
          // multi-root guard through uncaughtError instead — flush() rethrows
          // it right after the commit machinery finishes, so the failure is
          // just as loud but the engine stays usable. A commit driven by the
          // scheduler never passes through flush(), so mirror the
          // onUncaughtError microtask fallback (no-op when flush consumed it).
          this.uncaughtError = error;
          queueMicrotask(() => {
            if (this.uncaughtError === error) {
              this.uncaughtError = null;
              throw error;
            }
          });
          return;
        }
        const json = JSON.stringify(tree);
        // Budget tripwire (ARCH-13): checked on every serialized commit —
        // including one the dedup below drops, since an unchanged huge tree
        // is still a huge tree. WARN only; the commit proceeds regardless.
        this.checkCommitBudgets(json.length, container.instances.size);
        container.dirty = false;
        this.lastCommittedSeq = container.lastSeq;
        // Bail on no-op commits: a re-render that produces a byte-identical
        // payload (seq is in the payload, so identity covers both tree and
        // ack) needs no native decode or SwiftUI invalidation. Every
        // production reconciler skips no-op commits; any real change or seq
        // advance makes the JSON differ and is sent.
        if (json === this.lastCommitJson) return;
        this.lastCommitJson = json;
        this.commitCount += 1;
        // Hand the native bridge the JSON we already computed for dedup so it
        // need not stringify the same tree again (object hosts ignore it).
        host.commit(tree, json);
      },
    };
    this.container = container;
    this.root = reconciler.createContainer(
      container,
      ConcurrentRoot,
      null,
      false,
      null,
      "",
      (error: unknown) => {
        this.uncaughtError = error;
        // A commit driven by the scheduler (an effect-scheduled render on a
        // host-timer turn) never passes through flush(), so without a
        // fallback the stored error would sit until the *next* native
        // event — delayed and misattributed, or silent forever. If a
        // synchronous flush doesn't consume it first, rethrow from a
        // microtask: QuickJS's job drain surfaces it to the host onError,
        // vitest fails the test. A sync flush clears the field, making
        // this a no-op.
        queueMicrotask(() => {
          if (this.uncaughtError === error) {
            this.uncaughtError = null;
            throw error;
          }
        });
      },
      reconciler.defaultOnCaughtError,
      reconciler.defaultOnRecoverableError,
      null,
    );
  }

  render(element: ReactNode): void {
    reconciler.updateContainerSync(element, this.root, null, null);
    this.flush();
  }

  unmount(): void {
    reconciler.updateContainerSync(null, this.root, null, null);
    this.flush();
  }

  /** Debug inspector: the current serialized tree + commit count. */
  inspect(): { commits: number; tree: SerializedTree } {
    return { commits: this.commitCount, tree: serializeTree(this.container) };
  }

  /**
   * Entry point for native interaction events. `handled` is false for
   * unknown/stale nodes or events with no handler — but the seq is ALWAYS
   * acked (CX-010), so an optimistic native control is released/rolled back,
   * never stranded. The cases that used to strand: no handler (early return
   * before the ack), and a throwing handler (the ack path was skipped). Both
   * now ack in a `finally`; a handler's exception still propagates afterwards.
   *
   * `accepted` (ARCH-09): for `pathChange` it's computed AFTER the flush by
   * comparing the stack node's now-committed path against the proposal —
   * which is why a controlled `onPathChange` must fold the path
   * SYNCHRONOUSLY (setState in the handler is fine; this dispatch flushes it
   * before comparing). An async fold reads as a decline and native snaps
   * back. Other events: `accepted` mirrors `handled`.
   */
  dispatchEvent(event: WatchEvent): DispatchResult {
    const instance = this.container.instances.get(event.nodeId);
    if (event.seq !== undefined && event.seq > this.container.lastSeq) {
      this.container.lastSeq = event.seq;
    }
    const commitsBefore = this.commitCount;
    const previousPriority = currentUpdatePriority;
    currentUpdatePriority = DiscreteEventPriority;
    let handled = false;
    try {
      if (instance) handled = dispatchToInstance(instance, event);
    } finally {
      currentUpdatePriority = previousPriority;
      // Settle even if there was no handler or it threw: flush any queued
      // state, then guarantee the ack. A no-op/absent/throwing handler that
      // produced no commit still owes native the seq, or the optimistic control
      // holds its local value forever.
      try {
        this.flush();
      } finally {
        if (event.seq !== undefined && this.commitCount === commitsBefore) {
          this.container.onCommit();
        }
      }
    }
    if (event.event === "pathChange") {
      // Post-flush: instance.props now holds the committed values, so the
      // comparison sees exactly what the handler folded (or didn't).
      const accepted = pathChangeAccepted(instance, handled, event.payload);
      return accepted
        ? { handled, accepted }
        : { handled, accepted, reason: "declined" };
    }
    return { handled, accepted: handled };
  }

  /**
   * Runs `fn` at urgent (discrete) priority and flushes synchronously, so
   * any state it changes commits before returning — the same path a tap
   * takes. Native pushes (connection state, sensors, incoming messages)
   * go through here to react instantly instead of waiting for the
   * scheduler's next default-priority turn.
   */
  runSync<T>(fn: () => T): T {
    const previousPriority = currentUpdatePriority;
    currentUpdatePriority = DiscreteEventPriority;
    try {
      return fn();
    } finally {
      // Flush in the finally, mirroring the tap path (dispatchEvent). A native-
      // event listener that throws is already absorbed by dispatchNativeEvent,
      // so for the current caller this guards a fn that throws BEFORE mutating
      // (a malformed-payload JSON.parse) and any future caller whose fn can throw
      // after a state change — the commit still lands and the error propagates.
      currentUpdatePriority = previousPriority;
      this.flush();
    }
  }

  private flush(): void {
    reconciler.flushSyncWork();
    // One passive pass is the most a synchronous flush can do: React forces
    // update priority to Default while passive effects run, so a render
    // scheduled *by* an effect always lands on the scheduler's next turn
    // (one host-timer hop — the documented model in README "Updating the
    // UI"). Looping flushPassiveEffects here cannot pull those commits
    // forward; errors from those later turns are surfaced by the
    // onUncaughtError microtask fallback in the constructor.
    reconciler.flushPassiveEffects();
    reconciler.flushSyncWork();
    if (this.uncaughtError != null) {
      // React swallows render errors into onUncaughtError on concurrent
      // roots; a watch app with a broken UI must fail loudly instead.
      const error = this.uncaughtError;
      this.uncaughtError = null;
      throw error;
    }
  }
}
