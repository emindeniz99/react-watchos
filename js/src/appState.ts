import { registerNativeListener, type Unsubscribe } from "./nativeEvents";

/**
 * App-level display state pushed from the watch.
 *
 * Today that is one signal: **Always-On**. On Apple Watch the display stays on
 * when the user lowers their wrist — your app keeps rendering, at reduced
 * luminance, to a screen nobody is looking at. A `setInterval` poll, a chart
 * animation, or a timer that ticks every 100 ms goes on costing CPU wakeups
 * and pixels the whole time. {@link onLuminanceReduced} is the signal to stand
 * down.
 *
 * Two things worth knowing, both from Apple's own docs:
 *
 * - **Your app participates in Always-On by default** on watchOS 8+. There is
 *   no opt-in to make; the opt-*out* is setting `WKSupportsAlwaysOnDisplay` to
 *   `false` in the watch target's Info.plist, which makes the system blur the
 *   screen on wrist-down instead. That is the escape hatch for an app that
 *   cannot afford to keep rendering — not a substitute for pausing work.
 * - **`scenePhase` is not this signal.** The SwiftUI docs define no
 *   `ScenePhase` value for the Always-On state, so a wrist-down app is not
 *   "background" and keying off `scenePhase` will not catch it. This is the
 *   one signal.
 *
 * Pair it with Apple's own rendering advice for the dimmed state — "lower the
 * overall brightness of your view… change large, filled shapes to be stroked,
 * and choose less bright colors" — and drop your cadence, e.g. seconds instead
 * of hundredths.
 *
 * It compounds with `docs/perf-battery-audit-2026-07-08.md` §P1-1 (JS timers
 * scheduled with near-zero leeway, the broadest ongoing cost in the runtime):
 * an app that pauses its timers on wrist-down removes those wakeups entirely
 * rather than merely coalescing them.
 */

/** Native event carrying `{ reduced: boolean }`. */
export const LUMINANCE_REDUCED_EVENT = "luminanceReduced";

/**
 * Runs `handler` whenever the display enters or leaves reduced luminance
 * (Always-On wrist-down). Returns an unsubscribe.
 *
 * The handler is also called **once on mount** with the current state, so an
 * app that launches while the wrist is already down learns it immediately
 * instead of believing luminance is normal until the next wrist movement.
 *
 * ```tsx
 * const [dimmed, setDimmed] = useState(false);
 * useEffect(() => onLuminanceReduced(setDimmed), []);
 * useEffect(() => {
 *   if (dimmed) return;              // wrist down: no ticking
 *   const t = setInterval(tick, 100);
 *   return () => clearInterval(t);
 * }, [dimmed]);
 * ```
 */
export function onLuminanceReduced(
  handler: (reduced: boolean) => void,
): Unsubscribe {
  // Unwrapped to a bare boolean rather than handed the raw payload — the
  // onRemotePushToken shape. A single-field event whose consumer writes
  // `p?.reduced` gains nothing from the envelope.
  return registerNativeListener(LUMINANCE_REDUCED_EVENT, (payload) => {
    handler(Boolean(payload?.reduced));
  });
}

/** Native event carrying `{ phase: ScenePhase }`. */
export const SCENE_PHASE_EVENT = "scenePhase";

/**
 * SwiftUI's `ScenePhase`, as the host pushes it.
 *
 * - `active` — on screen and interactive.
 * - `inactive` — on screen but should pause: the Now Playing view is up, the
 *   user is scrubbing the Control Center, a sheet is being dismissed.
 * - `background` — not on screen. Effect cleanups do **not** run here (the app
 *   is not unmounted), which is why this event exists.
 */
export type ScenePhase = "active" | "inactive" | "background";

/**
 * Runs `handler` whenever the app's scene phase changes. Returns an
 * unsubscribe.
 *
 * The typed wrapper over an event the host has always pushed — `scenePhase` was
 * reachable only through `registerNativeListener("scenePhase", …)` and a
 * hand-written `String(p?.phase)`, which is a union this package can spell.
 *
 * The handler is also called **once on subscribe** with the last phase the host
 * pushed, so a screen mounted after a transition learns the phase instead of
 * waiting for the next one. Honest limit: the host pushes on CHANGE only, with
 * no initial push at launch, so a subscriber that mounts before the first
 * transition is called with nothing — a launched app is `active` and that is
 * the state you already have.
 *
 * **This is not the Always-On signal.** A wrist-down app stays `active`;
 * SwiftUI defines no `ScenePhase` value for reduced luminance. Use
 * {@link onLuminanceReduced} for that — they answer different questions and an
 * app that needs to stand down needs both.
 *
 * ```tsx
 * useEffect(() => onScenePhase((phase) => setPaused(phase !== "active")), []);
 * ```
 */
export function onScenePhase(
  handler: (phase: ScenePhase) => void,
): Unsubscribe {
  return registerNativeListener(SCENE_PHASE_EVENT, (payload) => {
    const phase = payload?.phase;
    // Allowlist, the onConnectivityState shape. A phase this binary cannot name
    // is a SwiftUI case added after it shipped; reporting `active` makes such a
    // push equivalent to no push at all, which is the state a caller is already
    // in — the alternative, guessing `background`, would stand an app down for
    // a phase that might be on screen.
    handler(phase === "inactive" || phase === "background" ? phase : "active");
  });
}
