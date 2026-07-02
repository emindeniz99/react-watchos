import { createContext, type ReactNode } from "react";
import Reconciler from "react-reconciler";
import {
  ConcurrentRoot,
  DefaultEventPriority,
  DiscreteEventPriority,
  NoEventPriority,
} from "react-reconciler/constants";
import { dispatchToInstance } from "./events";
import type { HostBridge, SerializedTree, WatchEvent } from "./host";
import { serializeTree } from "./serialize";

export interface Instance {
  id: number;
  type: string;
  props: Record<string, unknown>;
  children: Instance[];
  container: Container;
}

export interface Container {
  children: Instance[];
  instances: Map<number, Instance>;
  nextId: number;
  /** Highest event seq processed; acked on every commit (tree.seq). */
  lastSeq: number;
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
  rendererPackageName: "react-native-watchos",
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
  createTextInstance(): never {
    throw new Error("Raw text must be wrapped in a <Text> element");
  },
  // Text folds its string children into props.text at serialization, so
  // React must not create child fibers for them.
  shouldSetTextContent: (type: string) => type === "Text",
  appendInitialChild: (parent: Instance, child: Instance) => {
    parent.children.push(child);
  },
  finalizeInitialChildren: () => false,
  commitMount() {},
  commitUpdate(
    instance: Instance,
    _type: string,
    _oldProps: Record<string, unknown>,
    newProps: Record<string, unknown>,
  ) {
    instance.props = newProps;
  },
  commitTextUpdate() {},
  resetTextContent() {},
  appendChild: (parent: Instance, child: Instance) => {
    parent.children.push(child);
  },
  appendChildToContainer: (container: Container, child: Instance) => {
    container.children.push(child);
  },
  insertBefore: (parent: Instance, child: Instance, before: Instance) => {
    insertInto(parent.children, child, before);
  },
  insertInContainerBefore: (
    container: Container,
    child: Instance,
    before: Instance,
  ) => {
    insertInto(container.children, child, before);
  },
  removeChild(parent: Instance, child: Instance) {
    removeFrom(parent.children, child);
  },
  removeChildFromContainer(container: Container, child: Instance) {
    removeFrom(container.children, child);
  },
  clearContainer(container: Container) {
    container.children = [];
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
    rendererPackageName: "react-native-watchos",
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

  constructor(host: HostBridge) {
    const container: Container = {
      children: [],
      instances: new Map(),
      nextId: 1,
      lastSeq: 0,
      onCommit: () => {
        const tree = serializeTree(container);
        const json = JSON.stringify(tree);
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
   * Entry point for native interaction events. Returns false for unknown/stale
   * nodes or events with no handler — but ALWAYS acks the seq (CX-010), so an
   * optimistic native control is released/rolled back, never stranded. The
   * cases that used to strand: no handler (early return before the ack), and a
   * throwing handler (the ack path was skipped). Both now ack in a `finally`;
   * a handler's exception still propagates afterwards.
   */
  dispatchEvent(event: WatchEvent): boolean {
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
    return handled;
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
