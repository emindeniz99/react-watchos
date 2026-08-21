/**
 * Query helpers for asserting on committed trees, exported as
 * `react-watchos/testing`. Pair with `runApp(element, new MemoryHost())`
 * (or `renderToTree`) — every consumer was otherwise re-writing `findByType`.
 *
 * Serialization quirks these helpers account for (see docs/updates.md):
 *   - `<Text>` content folds into `props.text`, not `children`.
 *   - function props (onPress, onChange, …) serialize to the literal `true`.
 *
 * (`@module` pins the typedoc module name — see the note in src/index.ts.)
 *
 * @module testing
 */

import type { SerializedNode } from "./generated/wire";

/** All nodes of a given type, in document order (depth-first, self first). */
export function findByType(
  node: SerializedNode,
  type: string,
): SerializedNode[] {
  return [
    ...(node.type === type ? [node] : []),
    ...node.children.flatMap((child) => findByType(child, type)),
  ];
}

/**
 * All nodes whose folded text (`props.text`) matches. A string matches by
 * exact equality; a RegExp by `.test()`. Because `<Text>` content lives in
 * `props.text`, this is how you assert on rendered copy.
 */
export function findByText(
  node: SerializedNode,
  text: string | RegExp,
): SerializedNode[] {
  const value = node.props.text;
  const self =
    typeof value === "string" &&
    (typeof text === "string" ? value === text : text.test(value))
      ? [node]
      : [];
  return [
    ...self,
    ...node.children.flatMap((child) => findByText(child, text)),
  ];
}

// ---------------------------------------------------------------------------
// App-level test harness (2026-08-06, from the first real consumer migration:
// every consumer was re-discovering the invoke wire, the single-root rule and
// the navigation-drive idiom by reading this package's own suite).

import type { ReactNode } from "react";
import {
  type HostBridge,
  runApp,
  unregisterAllIntents,
  unregisterAllNativeListeners,
  unregisterAllWidgets,
  type WatchRoot,
} from "./index";
import { OPEN_URL_EVENT } from "./navigation";
import { __resetSensorCountsForTest } from "./sensors";

/** Roots mounted through `mountApp`, newest last (torn down by `resetApp`). */
const mounted: WatchRoot[] = [];

/**
 * `runApp` for tests: the root is tracked so `resetApp` disposes it — without
 * this, the second test in a file hits `runApp`'s single-active-root guard
 * ("a root is already mounted"). Pair with `afterEach(resetApp)`.
 */
export function mountApp(element: ReactNode, host?: HostBridge): WatchRoot {
  const root = runApp(element, host);
  mounted.push(root);
  return root;
}

/**
 * The shared `afterEach` for any file that mounts an app: disposes every
 * `mountApp` root (newest first), clears the module-scope registries
 * (native listeners, intents, widgets, sensor counts) and removes the
 * `__host`/`__urlScheme` globals a test installed. A throwing effect cleanup
 * doesn't abort the rest of the teardown; the first error is rethrown at the
 * end so the failure stays loud.
 */
export function resetApp(): void {
  let failure: unknown;
  let failed = false;
  while (mounted.length > 0) {
    try {
      mounted.pop()?.dispose();
    } catch (error) {
      if (!failed) {
        failed = true;
        failure = error;
      }
    }
  }
  unregisterAllNativeListeners();
  unregisterAllIntents();
  unregisterAllWidgets();
  __resetSensorCountsForTest();
  const g = globalThis as Record<string, unknown>;
  delete g.__host;
  delete g.__urlScheme;
  if (failed) throw failure;
}

/** One recorded invoke: the method plus its parsed payload (or undefined). */
export interface RecordedInvoke {
  method: string;
  payload: unknown;
}

/**
 * Per-method outcomes for {@link installInvokeHost}: a value resolves the
 * invoke with it; a function is called with the parsed payload and its return
 * value resolves — and a THROWN `{ code, message }` rejects the invoke with
 * that error instead. Methods not listed resolve `null`.
 */
export type InvokeHandlers = Record<
  string,
  unknown | ((payload: unknown) => unknown)
>;

/**
 * Installs a `__host` whose invoke channel records every call and settles it
 * on a microtask — the wire every fallible API (BLE, health, connectivity,
 * notifications, …) rides. Returns the recorded calls plus `uninstall`
 * (`resetApp` also removes it).
 *
 * ```ts
 * const { calls } = installInvokeHost({ requestNotificationPermission: "granted" });
 * await requestNotificationPermission();
 * expect(calls[0]).toEqual({ method: "requestNotificationPermission", payload: undefined });
 * ```
 */
export function installInvokeHost(handlers: InvokeHandlers = {}): {
  calls: RecordedInvoke[];
  uninstall: () => void;
} {
  const calls: RecordedInvoke[] = [];
  const g = globalThis as {
    __host?: unknown;
    __resolveInvoke?: (id: number, resultJson: string) => void;
    __rejectInvoke?: (id: number, errorJson: string) => void;
  };
  const host = {
    invoke(id: number, method: string, payloadJson: string) {
      const payload = payloadJson ? JSON.parse(payloadJson) : undefined;
      calls.push({ method, payload });
      // Settle asynchronously, as native does — the promise must not resolve
      // before the caller has a chance to observe pending state.
      queueMicrotask(() => {
        const handler = handlers[method];
        try {
          const result =
            typeof handler === "function"
              ? (handler as (p: unknown) => unknown)(payload)
              : (handler ?? null);
          g.__resolveInvoke?.(id, JSON.stringify(result ?? null));
        } catch (error) {
          g.__rejectInvoke?.(
            id,
            JSON.stringify(
              typeof error === "object" && error !== null
                ? error
                : { code: "INTERNAL", message: String(error) },
            ),
          );
        }
      });
    },
  };
  g.__host = host;
  return {
    calls,
    uninstall: () => {
      if (g.__host === host) delete g.__host;
    },
  };
}

/**
 * Drives navigation the way the platform does. A `NavigationLink` press is
 * confirmed by the NATIVE stack (ARCH-09's propose→confirm transaction), so
 * `dispatchEvent({event: "press"})` on a link deliberately returns
 * `{handled: false}` in a JS-only test — there is no native stack to confirm
 * it. Tests navigate through the deep-link channel instead, exactly like a
 * widget tap or notification would:
 *
 * ```tsx
 * mountApp(<App />, host); // App wraps NavigationProvider scheme="myapp"
 * pushDeepLink("myapp://settings");
 * ```
 *
 * Requires a mounted app (runApp installs the native-event channel) and a
 * `NavigationProvider` with a matching `scheme`.
 */
export function pushDeepLink(url: string): boolean {
  const push = (
    globalThis as {
      __pushNativeEvent?: (name: string, payloadJson?: string) => boolean;
    }
  ).__pushNativeEvent;
  if (!push) {
    throw new Error(
      "pushDeepLink: no native-event channel — mount the app first " +
        "(runApp/mountApp installs __pushNativeEvent)",
    );
  }
  return push(OPEN_URL_EVENT, JSON.stringify({ url }));
}
