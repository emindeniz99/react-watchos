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

  /** Entry point for native interaction events. Returns false for unknown/stale nodes. */
  dispatchEvent(event: WatchEvent): boolean {
    const instance = this.container.instances.get(event.nodeId);
    if (!instance) return false;
    if (event.seq !== undefined && event.seq > this.container.lastSeq) {
      this.container.lastSeq = event.seq;
    }
    const commitsBefore = this.commitCount;
    const previousPriority = currentUpdatePriority;
    currentUpdatePriority = DiscreteEventPriority;
    try {
      if (!dispatchToInstance(instance, event)) return false;
    } finally {
      currentUpdatePriority = previousPriority;
    }
    this.flush();
    // A handler that causes no re-render still owes native the seq ack,
    // or optimistic controls would hold their local value forever.
    if (event.seq !== undefined && this.commitCount === commitsBefore) {
      this.container.onCommit();
    }
    return true;
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
    let result: T;
    try {
      result = fn();
    } finally {
      currentUpdatePriority = previousPriority;
    }
    this.flush();
    return result;
  }

  private flush(): void {
    reconciler.flushSyncWork();
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
