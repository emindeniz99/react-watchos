/**
 * The reconciler boundary (ARCH-14): this module is the ONLY file that may
 * import "react-reconciler" or "react-reconciler/constants" — everything
 * else (renderer.ts included) consumes the fully-typed surface exported
 * here. test/reconcilerAdapter.test.ts guards the import boundary and pins
 * the runtime constants.
 *
 * WHY THIS FILE EXISTS — the types/runtime version mismatch:
 * the runtime peer is pinned EXACTLY to react-reconciler@0.33.0, and the
 * typings are now @types/react-reconciler@0.33.0 — the SAME major, and
 * still not the same contract. 0.33.0 of the typings fixed the two rows
 * that were about the reconciler *instance*, but left the HostConfig
 * essentially at 0.32. Re-measured against @types 0.33.0 and
 * cjs/react-reconciler.{development,production}.js on 2026-07-29 by
 * deleting the cast and reading tsc:
 *
 * FIXED by @types 0.33.0 (no longer reasons to cast):
 *  - Reconciler instance: `updateContainerSync`, `flushSyncWork` and
 *    `flushPassiveEffects` are now declared on the `Reconciler` interface.
 *  - `createContainer` now declares the real 10 args ending in
 *    `onDefaultTransitionIndicator` (0.32 declared 11).
 *
 * STILL WRONG in @types 0.33.0 (each one proven by a tsc error when the
 * cast is removed — full list in docs/reconciler-version-matrix.md):
 *  - HostConfig still *requires* five members the 0.33 runtime tolerates
 *    missing — getInstanceFromNode, beforeActiveInstanceBlur,
 *    afterActiveInstanceBlur, prepareScopeUpdate, getInstanceFromScope
 *    (TS2345), and still *lacks* members both runtime builds read:
 *    maySuspendCommitOnUpdate, maySuspendCommitInSyncRender,
 *    bindToConsole, suspendOnActiveViewTransition, rendererVersion,
 *    rendererPackageName, extraDevToolsConfig.
 *  - `injectIntoDevTools(devToolsConfig)` still declares a REQUIRED arg;
 *    the 0.33 runtime's takes none (`.length === 0`) and the renderer's
 *    DevTools identity comes from the host config's rendererVersion /
 *    rendererPackageName / extraDevToolsConfig instead (TS2554).
 *  - `defaultOn{Caught,Recoverable,Uncaught}Error` are declared, but as
 *    MODULE-level functions; at runtime they live on the reconciler
 *    INSTANCE, which is where this adapter reads them (TS2339).
 *  - `onDefaultTransitionIndicator` is typed non-nullable `() => void`;
 *    the runtime accepts (and this renderer passes) `null` (TS2345).
 *  - Signature drift: getChildHostContext is `(parent, type)` at runtime
 *    but 3 args in the types; preloadInstance gained a leading `instance`;
 *    suspendInstance is `(suspendedState, instance, type, props)`;
 *    waitForCommitToBeReady takes `(suspendedState, timeoutOffsetMs)`.
 *    See WatchHostConfig below, whose members document the REAL shapes.
 *  - The constants module's declared VALUES are still stale — 0.33 ships
 *    constants.d.ts byte-identical to 0.32: Discrete/Continuous/Default/
 *    Idle as 1/4/16/2^30 where the runtime has 2/8/32/2^28. Correct at
 *    runtime (values come from the real module); the re-exports below
 *    erase the stale literal types.
 *  - `OpaqueRoot` is `any` in the typings; the branded OpaqueRoot below is
 *    strictly stronger, and the factory infers HostConfig<unknown × 14>,
 *    so adopting the library's generics would erase Container typing too.
 *
 * That mismatch is why ONE unsafe cast exists in this package — the
 * factory bridge below. Everything on both sides of it is typed.
 *
 * UPGRADE PROCEDURE (also in docs/reconciler-version-matrix.md): bump
 * react/react-reconciler/@types together, diff the new runtime's
 * `$$$config.*` reads + call sites against WatchHostConfig and
 * ReconcilerExports, update them, run the gates (typecheck, vitest,
 * build + tools/embed-smoke), fix the pinned-constants test, then add a
 * row to the version matrix.
 */
import type { Context, ReactNode } from "react";
import Reconciler from "react-reconciler";
import {
  ConcurrentRoot,
  DefaultEventPriority as RuntimeDefaultEventPriority,
  DiscreteEventPriority as RuntimeDiscreteEventPriority,
  NoEventPriority as RuntimeNoEventPriority,
} from "react-reconciler/constants";

/**
 * Priority lane an update is scheduled at. Values are the 0.33 runtime's
 * (the @types literals are stale in 0.33 too — see header); treat them as
 * opaque numbers, compare only against the constants below.
 */
export type EventPriority = number;

/** No update in flight — the falsy sentinel resolveUpdatePriority checks. */
export const NoEventPriority: EventPriority = RuntimeNoEventPriority;
/** Urgent: taps and other discrete user input (flushed synchronously). */
export const DiscreteEventPriority: EventPriority =
  RuntimeDiscreteEventPriority;
/** Normal: renders with no event attribution (scheduler's next turn). */
export const DefaultEventPriority: EventPriority = RuntimeDefaultEventPriority;

/**
 * The host-config contract react-reconciler@0.33 ACTUALLY exercises for a
 * mutation-mode, non-hydrating renderer — every member the renderer
 * provides, with the argument lists the 0.33 runtime really passes
 * (several still differ from the @types 0.33 typings; implementations may
 * declare fewer/narrower parameters as usual). Members the runtime reads
 * but this renderer does not provide (hydration, persistence, resources,
 * singletons, view transitions, fragment instances, test selectors,
 * getInstanceFromNode & friends) are deliberately absent: the flags below
 * gate their code paths off, and the suite + embed smoke prove absence is
 * fine.
 */
export interface WatchHostConfig<Type, Props, Container, Instance> {
  // Mode flags — pinned to literals because flipping any of these changes
  // WHICH members the runtime requires (i.e. this very contract).
  supportsMutation: true;
  supportsPersistence: false;
  supportsHydration: false;
  supportsMicrotasks: true;
  supportsResources: false;
  supportsSingletons: false;
  supportsTestSelectors: false;
  isPrimaryRenderer: boolean;
  /** Read but discarded by 0.33 (both builds). */
  warnsIfNotActing: boolean;
  /** Sentinel scheduleTimeout's handle is compared against. */
  noTimeout: -1;
  // DevTools identity — 0.33 reads these from the host config (NOT from
  // injectIntoDevTools arguments, which no longer exist).
  rendererVersion: string;
  rendererPackageName: string;
  extraDevToolsConfig: null;

  // Host context. Non-null objects only: React's context stack rejects
  // null when crossing a Suspense boundary ("Expected host context to
  // exist"), so the type forbids the null the @types typings allow.
  getRootHostContext(rootContainer: Container): object;
  /** 0.33 passes (parent, type); the typings' 3rd rootContainer arg is stale. */
  getChildHostContext(parentHostContext: object, type: Type): object;

  getPublicInstance(instance: Instance): Instance;
  prepareForCommit(containerInfo: Container): Record<string, unknown> | null;
  resetAfterCommit(containerInfo: Container): void;
  preparePortalMount(containerInfo: Container): void;
  scheduleTimeout(fn: () => void, delay?: number): unknown;
  cancelTimeout(id: unknown): void;
  scheduleMicrotask(fn: () => void): void;

  createInstance(
    type: Type,
    props: Props,
    rootContainer: Container,
    hostContext: object,
    internalHandle: unknown,
  ): Instance;
  createTextInstance(
    text: string,
    rootContainer: Container,
    hostContext: object,
    internalHandle: unknown,
  ): Instance;
  shouldSetTextContent(type: Type, props: Props): boolean;
  appendInitialChild(parentInstance: Instance, child: Instance): void;
  finalizeInitialChildren(
    instance: Instance,
    type: Type,
    props: Props,
    rootContainer: Container,
    hostContext: object,
  ): boolean;

  // Mutation methods. TextInstance == Instance in this renderer (raw text
  // segments are ordinary instances with rawText set), so the runtime's
  // `Instance | TextInstance` unions collapse.
  commitMount(
    instance: Instance,
    type: Type,
    props: Props,
    internalHandle: unknown,
  ): void;
  commitUpdate(
    instance: Instance,
    type: Type,
    prevProps: Props,
    nextProps: Props,
    internalHandle: unknown,
  ): void;
  commitTextUpdate(
    textInstance: Instance,
    oldText: string,
    newText: string,
  ): void;
  resetTextContent(instance: Instance): void;
  appendChild(parentInstance: Instance, child: Instance): void;
  appendChildToContainer(container: Container, child: Instance): void;
  insertBefore(
    parentInstance: Instance,
    child: Instance,
    beforeChild: Instance,
  ): void;
  insertInContainerBefore(
    container: Container,
    child: Instance,
    beforeChild: Instance,
  ): void;
  removeChild(parentInstance: Instance, child: Instance): void;
  removeChildFromContainer(container: Container, child: Instance): void;
  clearContainer(container: Container): void;
  detachDeletedInstance(instance: Instance): void;
  hideInstance(instance: Instance): void;
  unhideInstance(instance: Instance, props: Props): void;
  hideTextInstance(textInstance: Instance): void;
  unhideTextInstance(textInstance: Instance, text: string): void;

  // Update-priority plumbing (the sync-flush model depends on these).
  setCurrentUpdatePriority(newPriority: EventPriority): void;
  getCurrentUpdatePriority(): EventPriority;
  resolveUpdatePriority(): EventPriority;
  /** Dev-build event timing; the prod build discards both. */
  resolveEventType(): null | string;
  resolveEventTimeStamp(): number;
  shouldAttemptEagerTransition(): boolean;
  /** Dev-build scheduler profiling hook; prod discards it. */
  trackSchedulerEvent(): void;
  /** Read but discarded by 0.33 (post-paint flag off in this build). */
  requestPostPaintCallback(callback: (time: number) => void): void;

  // Suspensey-commit surface. maySuspendCommit returning false keeps every
  // deeper member unreachable; signatures still document the real 0.33
  // shapes (@types 0.33 still declares preloadInstance/suspendInstance without the
  // instance/state arguments).
  maySuspendCommit(type: Type, props: Props): boolean;
  maySuspendCommitOnUpdate(
    type: Type,
    oldProps: Props,
    newProps: Props,
  ): boolean;
  preloadInstance(instance: Instance, type: Type, props: Props): boolean;
  startSuspendingCommit(): void;
  suspendInstance(
    suspendedState: unknown,
    instance: Instance,
    type: Type,
    props: Props,
  ): void;
  /** Read but discarded by 0.33 (view transitions flagged off). */
  suspendOnActiveViewTransition(container: Container): boolean;
  waitForCommitToBeReady(
    suspendedState: unknown,
    timeoutOffsetMs: number,
  ): null | ((initiateCommit: () => void) => () => void);

  // Form/transition status surface (required reads even when unused).
  NotPendingTransition: null;
  HostTransitionContext: Context<null>;
  resetFormInstance(form: unknown): void;
  /**
   * Dev-build console badging for boundary-caught errors; prod discards
   * it. 0.33 calls (methodName, args, badgeName) and invokes the return.
   */
  bindToConsole(
    methodName: string,
    args: unknown[],
    badgeName: string,
  ): () => void;
}

declare const opaqueRootBrand: unique symbol;
/**
 * A live fiber root as returned by createContainer. Opaque on purpose:
 * root internals are reconciler-private, and the brand stops anything else
 * from being passed back into updateContainerSync.
 */
export interface OpaqueRoot {
  readonly [opaqueRootBrand]: never;
}

/**
 * What the 0.33 factory really returns — the slice this package consumes,
 * with the runtime's true signatures (verified against the cjs builds;
 * see the header for how @types 0.33 still disagrees). This is the contract THE CAST
 * below asserts, so keep it honest: the compiler checks every use against
 * it, and only the suite + embed smoke check IT against the runtime.
 */
interface ReconcilerExports<Container> {
  createContainer(
    containerInfo: Container,
    tag: typeof ConcurrentRoot,
    hydrationCallbacks: null,
    isStrictMode: boolean,
    concurrentUpdatesByDefaultOverride: null | boolean,
    identifierPrefix: string,
    onUncaughtError: (
      error: unknown,
      errorInfo: { componentStack?: string },
    ) => void,
    onCaughtError: (
      error: unknown,
      errorInfo: { componentStack?: string; errorBoundary?: unknown },
    ) => void,
    onRecoverableError: (
      error: unknown,
      errorInfo: { componentStack?: string },
    ) => void,
    onDefaultTransitionIndicator: (() => void) | null,
  ): OpaqueRoot;
  /** Renders at sync priority; returns the lane (always SyncLane = 2). */
  updateContainerSync(
    element: ReactNode | null,
    container: OpaqueRoot,
    parentComponent: null,
    callback: (() => void) | null,
  ): number;
  /** True means "already inside a render — flush deferred". */
  flushSyncWork(): boolean;
  /** True when passive effects were actually flushed. */
  flushPassiveEffects(): boolean;
  /** No arguments in 0.33 — identity comes from the host config. */
  injectIntoDevTools(): boolean;
  defaultOnCaughtError(error: unknown): void;
  defaultOnRecoverableError(error: unknown): void;
}

/**
 * THE one unsafe cast in this package — the bridge between our typed
 * contract and the mistyped library.
 *
 * WHY: @types/react-reconciler@0.33 still mis-describes the pinned 0.33
 * runtime (full drift list in the header). Measured 2026-07-29 by deleting
 * this cast: its factory type rejects our valid host config (it demands
 * five members 0.33 tolerates missing), rejects `injectIntoDevTools()`
 * with no args, cannot see `defaultOn*Error` on the instance, and rejects
 * a null `onDefaultTransitionIndicator` — six tsc errors. It also infers
 * `HostConfig<unknown × 14>` and types roots as `any`, so routing through
 * it would need TWO casts and would lose the Container/OpaqueRoot typing
 * this file provides. One cast here is the cheapest honest bridge.
 *
 * WHAT IT HIDES: the compiler no longer connects the library to
 * WatchHostConfig / ReconcilerExports. If a future react-reconciler stops
 * reading a member, changes an argument list, or renames an export, tsc
 * stays green and only the vitest suite + tools/embed-smoke (the real
 * QuickJS engine) catch it. That risk is bounded by pinning the runtime
 * exactly (peer "react-reconciler": "0.33.0").
 *
 * UPGRADE: never bump the pin without re-verifying both interfaces against
 * the new runtime — procedure in docs/reconciler-version-matrix.md.
 */
const createReconcilerInstance = Reconciler as unknown as <
  Type,
  Props,
  Container,
  Instance,
>(
  hostConfig: WatchHostConfig<Type, Props, Container, Instance>,
) => ReconcilerExports<Container>;

/** The typed reconciler handle the renderer works against. */
export interface WatchReconciler<Container> {
  /**
   * Creates a concurrent root for `containerInfo`. Everything else about
   * root creation is fixed policy baked in here: no hydration, non-strict
   * mode, empty useId prefix, React's default caught/recoverable error
   * handlers, no transition indicator.
   */
  createContainer(
    containerInfo: Container,
    onUncaughtError: (error: unknown) => void,
  ): OpaqueRoot;
  /** Schedules `element` into `root` at sync priority. */
  updateContainerSync(element: ReactNode | null, root: OpaqueRoot): void;
  /** True means "already inside a render — flush deferred". */
  flushSyncWork(): boolean;
  /** True when passive effects were actually flushed. */
  flushPassiveEffects(): boolean;
  /** Registers with a React DevTools hook if one is installed. */
  injectIntoDevTools(): boolean;
}

/**
 * Instantiates react-reconciler with our host config. Call it ONCE at
 * module scope: each call builds an independent reconciler whose
 * module-level commit state is not shared, and the multi-root guarantees
 * (NF-06) assume all roots live on one instance.
 */
export function createReconciler<Type, Props, Container, Instance>(
  hostConfig: WatchHostConfig<Type, Props, Container, Instance>,
): WatchReconciler<Container> {
  const reconciler = createReconcilerInstance(hostConfig);
  return {
    createContainer: (containerInfo, onUncaughtError) =>
      reconciler.createContainer(
        containerInfo,
        ConcurrentRoot,
        null, // hydrationCallbacks — supportsHydration: false
        false, // isStrictMode — no double-invoking on the watch
        null, // concurrentUpdatesByDefaultOverride
        "", // identifierPrefix — single root, bare useIds are unique
        onUncaughtError,
        reconciler.defaultOnCaughtError,
        reconciler.defaultOnRecoverableError,
        null, // onDefaultTransitionIndicator — no pending-transition UI
      ),
    updateContainerSync: (element, root) => {
      reconciler.updateContainerSync(element, root, null, null);
    },
    flushSyncWork: () => reconciler.flushSyncWork(),
    flushPassiveEffects: () => reconciler.flushPassiveEffects(),
    injectIntoDevTools: () => reconciler.injectIntoDevTools(),
  };
}
