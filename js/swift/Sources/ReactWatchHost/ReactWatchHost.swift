// watchOS-only host (WatchKit/UIKit/HealthKit/SwiftUI). The #if compiles this
// file to an empty module off-watchOS so `swift test` runs on macOS — see Package.swift.
#if os(watchOS)
import CryptoKit
import MapKit
import Observation
import ReactWatchCore
import ReactWatchRuntime
import ReactWatchSupport
import SwiftUI
import UserNotifications
import WatchKit
import WidgetKit
#if canImport(FoundationModels)
import FoundationModels
#endif

// The public watch host: a consumer's @main App embeds `ReactWatchRootView`,
// and that's the whole integration (plus shipping bundle.js as a resource).
// Everything below — runtime ownership, tree decoding, optimistic state, the
// native bridges — was the app's ReactAppModel; it now lives in the package.
//
// NOTE: SwiftUI + WatchKit/WidgetKit + the native bridges can't compile on
// Linux, so this target is the macOS gate. The engine (CQuickJS), the wire
// models (ReactWatchCore), and the embedding (ReactWatchRuntime) are all
// built and smoke-tested on Linux.

/// Loads bundle.js into QuickJS and republishes every committed React tree
/// as SwiftUI state.
///
/// `@Observable` (Observation framework), NOT legacy `ObservableObject`
/// (audit P1-5): the old model fired `objectWillChange` on EVERY `@Published`
/// write, and every `NodeView` observed the whole model — so each optimistic
/// tick (toggle/slider/crown/drag) re-evaluated the body of every node on
/// screen, re-running all their per-render work. With per-property tracking a
/// node re-renders only when a property it actually READ changes: plain
/// content never touches `optimistic`, so interactions no longer redraw it,
/// and per-commit bookkeeping writes (`ackedSeq`) invalidate no views at all.
@Observable
@MainActor
final class ReactWatchModel {
    var root: RNNode?
    /// Latest fatal diagnostic (boot failure, wire mismatch) — drives the
    /// full-screen error path. Observable: the root view reads it.
    var latestFatal: Diagnostic?
    /// Latest recoverable diagnostic — drives the dismissible banner
    /// (tap-dismiss sets it nil). Observable: the root view reads it.
    var latestRecoverable: Diagnostic?
    /// The startup-error concept, kept as a DERIVED accessor over the
    /// structured diagnostics (ARCH-13): the latest fatal diagnostic's
    /// message, shown full-screen when nothing has rendered.
    var startupError: String? { latestFatal?.message }
    /// Set when the hard update gate refuses to boot stale JS (CR-17): the only
    /// available bundle is older than one already applied, so we show a native
    /// "update required" screen instead of running it against a newer-schema db.
    var updateRequired = false
    /// Highest event seq React has acknowledged (tree.seq). Optimistic
    /// controls hold their local value until their dispatch is acked.
    /// Not read from any view body, so its per-commit bump invalidates nothing.
    var ackedSeq = 0
    /// Optimistic values keyed by node id — lives on the model (not view
    /// @State) so it survives SwiftUI view identity changes mid-flight. The
    /// bookkeeping is ReactWatchSupport.OptimisticStore (unit-tested on Linux).
    private var optimistic = OptimisticStore()

    /// App Group storage, configured with the consumer's group id at init —
    /// no global mutable state. nil disables widget/Storage sharing.
    private let store: SharedWidgetStore
    /// Cross-process-atomic counters (ARCH-05), same App Group as `store`.
    private let counters: CoordinatedCounterStore
    /// The App-Group state revision (ARCH-06) — the same coordinated-counter
    /// primitive in its own subdirectory, so a bundle can't reach it through
    /// `Storage.counterAdd`. Every committed mutation moves it; every published
    /// payload is stamped with the value sampled at render start.
    private let revisionCounter: CoordinatedCounterStore
    /// Batches the bump to one file claim per mutation batch (ARCH-06).
    @ObservationIgnored private var revisionTracker = StateRevisionTracker()
    /// Reconciliation runs once per boot, off the first healthy commit — the
    /// point where JS is proven able to render, so `__republishWidgets` can
    /// actually answer.
    @ObservationIgnored private var reconciledThisBoot = false
    @ObservationIgnored private var runtime: JSRuntime?
    @ObservationIgnored private var nextSeq = 1
    /// Set once after reporting a renderer-vs-runtime wire mismatch.
    @ObservationIgnored private var warnedWireMismatch = false
    /// The last 50 diagnostics, always on — release builds too — for
    /// OTA-rollback forensics (ARCH-13). Ring only; the inspector exposure on
    /// top stays DEV/opt-in. Survives reloads: `sessionId` tells boots apart.
    @ObservationIgnored private let diagnostics = DiagnosticsBuffer()
    /// Default sink: one os.Logger line per diagnostic.
    @ObservationIgnored private let diagnosticsSink = LogDiagnosticsSink()
    /// Fresh UUID per boot() — stamps every diagnostic of one JS generation.
    @ObservationIgnored private var sessionId = UUID().uuidString
    /// Content hash of the bundle this boot actually evaluated (the CX-025
    /// releaseId injected as `__bundleReleaseId`); nil before load / for a
    /// DEBUG dev-code boot.
    @ObservationIgnored private var bootedReleaseId: String?
    /// True once this generation's bundle finished evaluating. Gates the
    /// `diagnostic` push to JS: before the bundle runs there is no
    /// `__pushNativeEvent` global, so pushing a boot notice would only
    /// manufacture a "global … is not a function" js error — and no listener
    /// could have registered yet anyway.
    @ObservationIgnored private var jsReady = false
    /// Operating budgets (ARCH-13): the native re-check of the commit payload
    /// size, done where the JSON is already in hand (the decode path). WARN
    /// only — a breach emits one recoverable `budget` diagnostic per crossing
    /// (BudgetPolicy's hysteresis) and the commit still renders; rejecting
    /// would desync ackedSeq/optimistic (CX-010). The node-count check lives
    /// JS-side (js/src/budgets.ts), where the instance map already knows it.
    @ObservationIgnored private var budgets = BudgetPolicy()
    /// markHealthy runs once per boot (see the commit handler) — after the
    /// first healthy commit it's a no-op that still cost a UserDefaults read
    /// per commit.
    @ObservationIgnored private var markedHealthyThisBoot = false
    /// Set when the bundle called `markUpdateHealthy()` from its module body or
    /// its first passive effect — i.e. synchronously inside `js.evaluate`,
    /// inside `otaSequencer.boot()`, before `bootedOTARecord` is known. Applied
    /// at the end of `load(into:)`, where the booted record finally is known.
    @ObservationIgnored private var pendingMarkHealthy = false
    /// Whether a committed tree may bless THIS boot's bundle, or the bundle
    /// must confirm itself via `markUpdateHealthy()` (ARCH-04). Decided ONCE
    /// per boot: the answer involves reading the known-good record off disk,
    /// which must not happen on the 10-20 commits/sec sensor path.
    @ObservationIgnored private var commitBlessesHealth = true
    /// Serial queue for decoding committed trees off the main thread.
    private let decodeQueue = DispatchQueue(label: "react.watch.decode")
    /// Reused across commits, decoded on the serial decodeQueue. No
    /// `nonisolated(unsafe)` needed: `JSONDecoder` is `Sendable` in the
    /// current SDK, so a plain isolated `let` crosses to the decode closure
    /// without a Swift 6 diagnostic. A fresh JSONDecoder per commit would be
    /// pure allocation churn at sensor-driven commit rates (10-20 commits/sec).
    private let treeDecoder = JSONDecoder()
    private let connectivity = PhoneConnectivity()
    private let bluetooth = BluetoothBridge()
    private let sensors = SensorBridge()
    /// Capability bridges (device/keychain/speech/runtime/background/iap),
    /// all routed through the invoke channel — see CapabilityBridges.swift.
    private let speechBridge = SpeechBridge()
    private let audioBridge = AudioBridge()
    private let extendedRuntime = ExtendedRuntimeBridge()
    /// HealthKit reads (js/src/health.ts). Owns its own HKHealthStore and the
    /// per-launch authorization cache; deliberately NOT the same store as the
    /// workout side, which asks for a SHARE grant this one never wants.
    private let health = HealthQueryBridge()
    /// WorkoutKit plans (js/src/workoutPlans.ts). STATELESS, and deliberately
    /// nothing like `workout` below: WorkoutKit is a document API, so there is
    /// no session, no claim and no teardown here — see the header of
    /// WorkoutPlanBridge.swift.
    private let workoutPlans = WorkoutPlanBridge()
    /// EventKit reads (js/src/calendar.ts). Owns the process's one long-lived
    /// `EKEventStore` — Apple warns that releasing a store before the objects
    /// it vended is an error, so a per-call store would free itself while the
    /// events it returned were still being read.
    private let calendar = CalendarBridge()
    /// The SINGLE owner of this process's HKWorkoutSession — watchOS runs one
    /// at a time and a second start kills the first, so the hidden heart-rate
    /// pump (`sensors`) and the explicit workout API (`workouts`) both take a
    /// claim on this one object rather than each constructing a session.
    private let workout = WorkoutSessionOwner()
    @ObservationIgnored private var fetchTasks: [Int: URLSessionDataTask] = [:]
    /// Bumped on every boot/reload (CX-008). Async work (fetch, generate) carries
    /// the JS-assigned id of a request whose id space resets with the runtime, so
    /// a callback from a previous generation could settle the WRONG pending
    /// request in the new one. Each async op captures the generation it started
    /// in and drops its result if it no longer matches.
    @ObservationIgnored private var generation = 0
    /// The one superseded generation whose `js` diagnostics are still wanted:
    /// the runtime `replaceRuntimeAfterPoisonedOTA()` throws away, plus the
    /// release id of the bundle that poisoned it. `js.onError` defers to main,
    /// so the failed bundle's job-throws and unhandled rejections are still
    /// QUEUED when that swap bumps past them on the same main-thread boot —
    /// without this the CX-008 guard would drop exactly the OTA-rollback
    /// forensics the always-on ARCH-13 ring exists for. Never cleared: the
    /// runtime it names is shut down, so nothing new can emit under it, and a
    /// later poisoned swap overwrites it.
    @ObservationIgnored private var poisonedGeneration: Int?
    @ObservationIgnored private var poisonedGenerationReleaseId: String?

    /// The live model, so the package's WKApplicationDelegate can forward a
    /// fired background-refresh task to JS (`deliverBackgroundRefresh`). A watch
    /// app has exactly one; weak so it doesn't outlive the scene. Main-isolated.
    static weak var shared: ReactWatchModel?

    /// Whether signing is disabled / enforced / misconfigured (CX-003). The
    /// full OTA policy (trusted keys, gate, shipped version) lives inside
    /// `otaSequencer`; the host keeps only this for the fail-open warning.
    private let updateKeyState: OTAKeyState
    private let updateManifestURL: String?
    /// The configured ARCH-04 health policy. The sequencer owns the decision;
    /// the host keeps it only to report it through `getUpdateState`, so fleet
    /// telemetry can see which policy a device's binary is on.
    private let updateHealthSignal: OTAHealthSignal
    /// The OTA staging + boot orchestration (M5), extracted to Linux-tested
    /// ReactWatchSupport. The host injects the App-Group file IO, the
    /// SharedWidgetStore counters, CryptoKit verification, and throwaway
    /// JSRuntime validate/compile closures.
    private let otaSequencer: OTABootSequencer
    /// CR-5 A/B selector for the Swift→JS bridge, applied to each runtime.
    private let useJSCallBridge: Bool
    /// The ARCH-07 effective feature set: `HostFeatures.watch` filtered by the
    /// consumer's `HostPolicy` ("core" always kept). Computed ONCE at init;
    /// every JS-facing or staging-facing read of the native feature set uses
    /// THIS — the runtime install allowlist, the published `__hostFeatures`
    /// (so the JS pre-download OTA gate respects the policy with zero JS
    /// changes), the invoke dispatcher's gate, and OTA staging.
    private let effectiveFeatures: Set<String>

    init(
        appGroupId: String?, ota: OTAConfig = .init(),
        useJSCallBridge: Bool = true, policy: HostPolicy = .allowAll
    ) {
        store = SharedWidgetStore(appGroupId: appGroupId)
        counters = CoordinatedCounterStore(appGroupId: appGroupId)
        revisionCounter = CoordinatedCounterStore(
            appGroupId: appGroupId,
            subdirectory: StateRevisionTracker.subdirectory)
        // Local binding: the validate closure below captures it (capturing
        // self.effectiveFeatures from an escaping closure inside init isn't
        // allowed before self is fully initialized).
        let effectiveFeatures = policy.effectiveFeatures(native: HostFeatures.watch)
        self.effectiveFeatures = effectiveFeatures
        let keys = ota.signerPublicKeys.compactMapValues {
            Data(base64Encoded: $0)
                .flatMap { try? Curve25519.Signing.PublicKey(rawRepresentation: $0) }
        }
        // CX-003: distinguish "no keys" (fail-open) from "keys configured but all
        // malformed" (fail CLOSED) — a base64 typo must not silently disable
        // signature enforcement the developer opted into.
        let keyState = OTAKeyState.classify(
            configuredCount: ota.signerPublicKeys.count, validCount: keys.count,
            allowUnsigned: ota.allowUnsignedUpdates)
        updateKeyState = keyState
        if keys.count < ota.signerPublicKeys.count {
            print(
                "[ReactWatch] WARNING: \(ota.signerPublicKeys.count - keys.count) OTA "
                    + "signing key(s) failed to decode and were dropped (CX-003).")
        }
        updateManifestURL = ota.manifestURL
        updateHealthSignal = ota.healthSignal
        self.useJSCallBridge = useJSCallBridge
        // Filenames come from the shared OTAFiles so the widget reads the same
        // paths; nil appGroupId disables OTA persistence (writes fail loudly).
        let otaFile: (String) -> URL? = { name in
            appGroupId.flatMap { OTAFiles.url(appGroupId: $0, name) }
        }
        otaSequencer = OTABootSequencer(
            config: .init(
                keyState: keyState, gate: ota.gate, shippedVersion: ota.shippedVersion,
                nativeBridgeProtocol: RNWire.bridgeProtocol,
                // Capability (what the binary CAN back) stays the full native
                // set; the policy ceiling is the separate ARCH-07 decision.
                nativeFeatures: HostFeatures.watch,
                policyAllowedFeatures: effectiveFeatures,
                maxBundleBytes: Self.maxOTABundleBytes,
                maxBootAttempts: Self.maxOTABootAttempts,
                healthSignal: ota.healthSignal),
            active: FileOTASlotStore(
                recordURL: otaFile(OTAFiles.activeRecord),
                bytecodeURL: otaFile(OTAFiles.activeBytecode)),
            knownGood: FileOTASlotStore(
                recordURL: otaFile(OTAFiles.knownGoodRecord),
                bytecodeURL: otaFile(OTAFiles.knownGoodBytecode)),
            counters: store,
            hasKey: { keys[$0] != nil },
            verify: { keyId, message, signature in
                keys[keyId]?.isValidSignature(signature, for: message) ?? false
            },
            // Same heap cap as the live runtime for both throwaway runtimes:
            // maxOTABundleBytes bounds the *source*, not allocation — an
            // unbounded validator lets a small bundle whose module init
            // allocates without limit OOM-kill the app during validation,
            // before any of the persist/rollback protections exist. Each gets
            // a private owning queue (M1) so staging stays off main (M5).
            validate: { source in
                // Mirror the live runtime's policy surface (ARCH-07) so a
                // bundle whose module init probes a policy-blocked feature
                // (typeof __host.fetch) fails HERE, at staging, instead of on
                // the next boot. The compile closure stays unrestricted: it
                // never RUNS the bundle (compile-only), so installs are moot.
                let validator = try JSRuntime(
                    memoryLimitBytes: 64 * 1024 * 1024,
                    queue: DispatchQueue(label: "react.watch.ota-validate"),
                    allowedFeatures: effectiveFeatures)
                // ARCH-08 §3.E: shut the throwaway runtime down EXPLICITLY,
                // even when evaluate() throws. The bundle we just ran is
                // attacker-influenced (signed, but not ours), and its module
                // init may have armed a setTimeout — leaving a live
                // DispatchSourceTimer on this private queue. Dropping the
                // validator on the staging thread would then free the engine
                // from off-queue while that timer's handler re-entered it.
                // `defer` runs on the owning queue via shutdown()'s hop, before
                // ARC releases the local.
                defer { validator.shutdown() }
                try validator.evaluate(source)
            },
            compile: { source in
                guard
                    let compiler = try? JSRuntime(
                        memoryLimitBytes: 64 * 1024 * 1024,
                        queue: DispatchQueue(label: "react.watch.ota-compile"))
                else { return nil }
                // Compile-only never RUNS the bundle, so no timer can be armed
                // here — but the runtime is still released on the staging
                // thread, so shut it down on its own queue for the same reason
                // and to keep all four sites on one rule.
                defer { compiler.shutdown() }
                return compiler.compileToBytecode(source)
            }
        )
    }

    func start() {
        guard runtime == nil else { return }
        Self.shared = self
        // Single source for the deep-link scheme: only the APP process can read
        // its registered CFBundleURLSchemes, so publish it into the App Group
        // for the widget extension (HostURLScheme / deepLinkURL). Idempotent.
        // In start(), not init: `@State`'s initialValue evaluates on every
        // ReactWatchRootView.init (a parent re-evaluation constructs and
        // discards a model), and side effects belong to the ONE retained
        // instance that actually starts.
        store.saveURLScheme(HostURLScheme.registered())
        // One wiring for all three inbound channels — PhoneConnectivity names
        // the event by delivery semantics (message / applicationContext /
        // userInfo, ARCH-12) and this just forwards it.
        connectivity.onPush = { [weak self] event, payload in
            self?.pushNativeEvent(event, payload: payload)
        }
        // A received file that could not be landed has no invoke to reject and
        // no event shape to carry a failure — without this it would vanish
        // (rule 12). Recoverable, so it also reaches the developer banner.
        connectivity.onError = { [weak self] code, details in
            self?.report(
                code: code, severity: .recoverable, subsystem: .connectivity,
                details: details)
        }
        // Lets PhoneConnectivity park a `watchConnectivity.file` event instead
        // of dropping it when it lands before `jsReady` — see
        // `replayParkedFileEvents` in boot().
        connectivity.isReady = { [weak self] in self?.jsReady ?? false }
        connectivity.activate()
        bluetooth.onState = { [weak self] state in
            self?.pushNativeEvent("ble.state", payload: ["state": state])
        }
        bluetooth.onNotify = { [weak self] characteristic, value, binary in
            var payload: [String: Any] = [
                "characteristic": characteristic, "value": value,
            ]
            // Only stamped for the base64 fallback, so existing text-protocol
            // consumers see an unchanged payload shape.
            if binary { payload["binary"] = true }
            self?.pushNativeEvent("ble.notify", payload: payload)
        }
        // Settle bleConnect/bleWrite/bleSubscribe invokes (CX-022). CoreBluetooth
        // delegates fire on the main queue (CBCentralManager queue: nil), so this
        // is already main-thread; a settle for a torn-down runtime hits a nil
        // runtime (or an unknown id the new runtime's pending map drops) — no-op,
        // not a mis-settle.
        bluetooth.onResolve = { [weak self] id, json in
            self?.runtime?.resolveInvoke(id: id, resultJson: json)
        }
        bluetooth.onReject = { [weak self] id, json in
            self?.runtime?.rejectInvoke(id: id, errorJson: json)
        }
        sensors.onReading = { [weak self] kind, payload in
            self?.pushNativeEvent("sensor.\(kind)", payload: payload)
        }
        sensors.workoutOwner = workout
        sensors.pedometer.onReading = { [weak self] payload in
            self?.pushNativeEvent("sensor.pedometer", payload: payload)
        }
        sensors.onLocationFix = { [weak self] locations in
            self?.workout.insertRoute(locations)
        }
        // Heart rate reaches JS through the owner's builder now, but on the
        // SAME `sensor.heartRate` event with the same payload — startHeartRate
        // is unchanged from JS's side whether the session behind it is the
        // hidden pump or an explicit workout.
        workout.onHeartRate = { [weak self] bpm in
            self?.pushNativeEvent("sensor.heartRate", payload: ["bpm": bpm])
        }
        workout.onState = { [weak self] state, reason, epoch in
            // Settle the parked starts from the REAL lifecycle before
            // publishing, so `await startWorkout()` means "running" rather than
            // "the request was submitted" — the extended-runtime precedent.
            self?.settleWorkoutStarts(state: state, reason: reason, epoch: epoch)
            // `endWorkout` is NOT the only way a session dies: Apple ends ours
            // when another app starts a workout (didFailWithError), a start
            // that throws never reaches the endWorkout completion, and a start
            // cancelled inside the authorization window never had a session.
            // The route rides the GPS at kCLLocationAccuracyBest with no
            // distance filter, so stopping it only in that completion leaves
            // full-rate GPS running until the next reload — and the stranded
            // `routeTracking` latch also makes the app's own `stopLocation()`
            // a permanent no-op. Idempotent, and `stopLocationIfIdle` still
            // leaves a live `startLocation` subscription alone.
            //
            // `!isWorkoutActive` is what makes this safe next to the UPGRADE:
            // a stale "ended" (an externally killed pump, say) must not stop
            // the route of a workout that has since started. It is false for
            // every legitimate terminal push — the owner clears its state
            // before emitting.
            if state == "ended", self?.workout.isWorkoutActive == false {
                self?.sensors.stopRouteTracking()
            }
            var payload: [String: Any] = ["state": state]
            if let reason { payload["reason"] = reason }
            self?.pushNativeEvent("workout.state", payload: payload)
        }
        workout.onMetrics = { [weak self] payload in
            self?.pushNativeEvent("workout.metrics", payload: payload)
        }
        speechBridge.onFinished = { [weak self] text in
            self?.pushNativeEvent("speech.finished", payload: ["text": text])
        }
        audioBridge.onFinished = { [weak self] in
            self?.pushNativeEvent("audio.finished")
        }
        extendedRuntime.onState = { [weak self] state, reason, epoch in
            // Settle the parked start invokes from the REAL lifecycle before
            // publishing the state, so `await startExtendedRuntimeSession()`
            // means "running" rather than "the request was submitted".
            self?.settleRuntimeSessionStarts(
                state: state, reason: reason, epoch: epoch)
            var payload: [String: Any] = ["state": state]
            if let reason { payload["reason"] = reason }
            self?.pushNativeEvent("runtimeSession.state", payload: payload)
        }
        extendedRuntime.onWillExpire = { [weak self] in
            self?.pushNativeEvent("runtimeSession.willExpire")
        }
        // Crash recovery, and deliberately HERE — once per PROCESS, in the
        // method guarded by `runtime == nil` — rather than in boot(), which
        // runs again on every reload. The two are different events and must
        // stay so: a reload ends its workout deterministically
        // (`tearDownForReload`, below), because the process is alive and an
        // incoming bundle must not inherit a workout it never started; this
        // adopts a session whose process DIED, which no runtime can be handed
        // back to and which is still holding the one system slot. Issued before
        // boot() so the owner's deferral is armed before the bundle's first
        // `startHeartRate` can take that slot and, per Apple, end the session
        // being recovered.
        workout.recoverOrphanedSession()
        boot()
        #if DEBUG
        startDevReload()
        #endif
    }

    /// Boots a fresh runtime, preferring precompiled bytecode (bundle.qbc)
    /// and falling back to parsing bundle.js.
    private func boot(devCode: String? = nil) {
        tearDownGeneration()
        root = nil
        latestFatal = nil
        latestRecoverable = nil
        updateRequired = false
        ackedSeq = 0
        nextSeq = 1
        optimistic = OptimisticStore()
        // A fresh diagnostics session per boot; the ring itself is kept so a
        // reload can't erase the evidence that forced it.
        sessionId = UUID().uuidString
        bootedReleaseId = nil
        jsReady = false
        // One warning per BOOT, not per model lifetime (NF-15): without the
        // reset, a second bad bundle after a dev hot-reload would be rejected
        // with no banner at all.
        warnedWireMismatch = false
        // Re-arm the once-per-boot markHealthy for the incoming generation.
        markedHealthyThisBoot = false
        pendingMarkHealthy = false
        // Same for the ARCH-06 reconcile: a reload swaps the bundle, so the
        // new generation must re-check the published payload against state
        // (the outgoing bundle's publications are the incoming one's problem).
        reconciledThisBoot = false
        // The incoming runtime has published nothing yet, so the first write
        // it makes opens a new mutation batch and must move the revision.
        revisionTracker = StateRevisionTracker()
        // Only the .runOTA branches repopulate this; without the reset a later
        // .runShipped or DEBUG dev-code boot retains the previous OTA record,
        // and the first-healthy-commit handler could promote a bundle that is
        // not the one actually running to known-good.
        bootedOTARecord = nil
        // Re-decided at the end of load() once the booted record is known; the
        // permissive default covers the paths that never reach that point
        // (a shipped/dev boot has nothing to withhold blessing from).
        commitBlessesHealth = true
        do {
            let js = try installFreshRuntime()
            if let devCode {
                try js.evaluate(devCode)
            } else {
                try load(into: js)
            }
            jsReady = true
            // Replay any `watchConnectivity.file` events that landed while
            // this generation wasn't ready yet (pre-boot, or a reload that
            // raced an inbound file) — see PhoneConnectivity.isReady /
            // replayParkedFileEvents. Before the listeners below: a fresh
            // generation should see its own received files in arrival order,
            // same as it would have without the race.
            connectivity.replayParkedFileEvents()
            // The incoming generation has registered its listeners but has
            // never seen a wrist-down, so tell it the state the root view
            // already knows. See pushLuminanceReduced for why this is not
            // redundant with the view's `.onChange(initial: true)`.
            pushLuminanceReduced()
        } catch {
            report(
                code: "boot.startupFailed", severity: .fatal, subsystem: .boot,
                details: "JS startup failed: \(error)")
        }
    }

    /// Tears the CURRENT JS generation down: stops every native async path that
    /// could settle into — or push into — the next runtime, then frees QuickJS
    /// on its owning queue.
    ///
    /// Called by `boot()` for a reload, and by `replaceRuntimeAfterPoisonedOTA()`
    /// for the fallback boot INSIDE one `boot()`. One implementation on purpose:
    /// two hand-written teardowns drift, and the half that drifts is the one
    /// that runs after a hostile bundle.
    private func tearDownGeneration() {
        // Tear down the previous generation's in-flight async before the id space
        // resets (CX-008): cancel outstanding fetches and stop sensor streams so
        // their callbacks can't settle against — or push stale readings into —
        // the fresh runtime. The BLE *connection* is intentionally left up (a
        // stateful link we don't want to drop on a dev hot-reload, and its
        // state/notify events are name-routed), but its connect/write/subscribe
        // invoke correlation is id-keyed (CX-022) and ids reset per runtime, so
        // drop the pending correlation or a late delegate could settle a NEW
        // promise that happens to reuse an old id.
        generation += 1
        for task in fetchTasks.values {
            task.cancel()
        }
        fetchTasks.removeAll()
        // ARCH-08: the workout slot is a single-occupancy SYSTEM resource, so
        // the outgoing generation must not leave one running for a runtime that
        // never started it. `tearDownForReload` ends AND saves it, parking the
        // summary for the fresh runtime's first getWorkoutState() — pushing an
        // event into a dying context would reach nobody.
        //
        // MUST run BEFORE sensors.stopAll(). stopAll() -> stopHeartRate() ->
        // releaseHeartRate() ends the heart-rate pump itself and nils the
        // owner's session/builder, after which tearDownForReload()'s
        // `guard session != nil` returns before detachDelegates() and the
        // outgoing session keeps this owner as its delegate — its trailing
        // callbacks then push a stale `workout.state` (and a late
        // `sensor.heartRate`) into the runtime boot() is about to install,
        // which is name-routed with no generation guard. Running it first also
        // makes the owner's `wasWorkout == false` branch reachable, which is
        // what ends a pump-only session on reload.
        workout.tearDownForReload()
        sensors.stopAll()
        bluetooth.resetPendingForReload()
        // Stop native media/session resources tied to the outgoing generation so
        // they can't drain battery or push stale finish/state events into the
        // fresh runtime (audio download+player+session, in-flight speech, and the
        // extended-runtime session). `silent:` suppresses the teardown-only
        // lifecycle event for the two that emit one on cancel/invalidate.
        audioBridge.stop()
        speechBridge.stop(silent: true)
        extendedRuntime.stop(silent: true)
        pendingWorkoutStarts.removeAll()
        // ARCH-08: free QuickJS explicitly, and ORDERED relative to the native
        // teardown above, instead of leaving it implicit in ARC. Both callers are
        // @MainActor and this runtime's owning queue IS main, so shutdown()
        // runs inline here — no hop, no deadlock — and any timer the outgoing
        // bundle armed is cancelled before the next generation's context
        // exists. `runtime = nil` then drops an already-shut-down object.
        runtime?.shutdown()
        runtime = nil
    }

    /// Constructs a JSRuntime and performs EVERY post-construction wiring step a
    /// bundle evaluation depends on — the bridge closures (`makeRuntime`), the
    /// ARCH-01/ARCH-07 capability publication, the DEBUG inspector URL — then
    /// installs it as the model's live runtime so settles and native pushes
    /// reach it.
    ///
    /// Extracted because the fallback boot after a poisoned OTA evaluation has
    /// to do all of it a SECOND time within one `boot()`. A hand-copied second
    /// sequence would drift the first time a wiring step is added, and the copy
    /// that silently lost a step would be the one running the recovery bundle.
    private func installFreshRuntime() throws -> JSRuntime {
        let js = try makeRuntime()
        runtime = js
        installHostCapabilities(js)
        #if DEBUG
        try? js.evaluate(
            "globalThis.__inspectorUrl='http://127.0.0.1:8099/snapshot'"
        )
        #endif
        return js
    }

    /// The one write path for every host error/notice (ARCH-13): records the
    /// structured diagnostic in the always-on ring, logs it through the sink,
    /// publishes the latest fatal/recoverable for the two UI surfaces, and
    /// forwards it to JS as a `diagnostic` native event — EXCEPT
    /// `js`-subsystem ones, which originated in JS: pushing those back in
    /// would let a listener that throws (or logs into a failing console) feed
    /// the next onError, an echo loop.
    private func report(
        code: String, severity: Diagnostic.Severity,
        subsystem: Diagnostic.Subsystem, details: String? = nil
    ) {
        report(
            Diagnostic(
                code: code, severity: severity, subsystem: subsystem,
                sessionId: sessionId, releaseId: bootedReleaseId,
                target: .watch, details: details))
    }

    private func report(_ diagnostic: Diagnostic) {
        diagnostics.append(diagnostic)
        diagnosticsSink.emit(diagnostic)
        switch diagnostic.severity {
        case .fatal: latestFatal = diagnostic
        case .recoverable: latestRecoverable = diagnostic
        case .info: break
        }
        guard diagnostic.subsystem != .js, jsReady else { return }
        var payload: [String: Any] = [
            "code": diagnostic.code,
            "severity": diagnostic.severity.rawValue,
            "subsystem": diagnostic.subsystem.rawValue,
            "sessionId": diagnostic.sessionId,
            "target": diagnostic.target.rawValue,
            "timestamp": diagnostic.timestamp,
        ]
        if let releaseId = diagnostic.releaseId {
            payload["releaseId"] = releaseId
        }
        if let userAction = diagnostic.userAction {
            payload["userAction"] = userAction
        }
        if let details = diagnostic.details { payload["details"] = details }
        pushNativeEvent("diagnostic", payload: payload)
    }

    /// Exposes this binary's capability set + bridge protocol to JS before the
    /// bundle runs (ARCH-01), so the JS OTA gate (update.ts) can refuse — before
    /// downloading — a bundle needing a feature this app doesn't provide.
    /// Publishes the EFFECTIVE set (ARCH-07), not the raw native one, so the
    /// same JS gate also refuses bundles the consumer's policy doesn't allow.
    private func installHostCapabilities(_ js: JSRuntime) {
        let features = effectiveFeatures.sorted()
        let json =
            (try? JSONSerialization.data(withJSONObject: features))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        try? js.evaluate(
            "globalThis.__hostFeatures=\(json);"
                + "globalThis.__bridgeProtocol=\(RNWire.bridgeProtocol);"
                // The app's registered deep-link scheme, so navigation.tsx
                // parses/builds URLs from the Info.plist value instead of a
                // hardcoded literal (empty string when unregistered → JS default).
                + HostURLScheme.inject(HostURLScheme.registered()),
            filename: "host-capabilities.js"
        )
    }

    /// The OTA record this launch actually booted (nil = running shipped). Set in
    /// `load`; read in the first-healthy-commit handler to promote it to the
    /// known-good snapshot.
    @ObservationIgnored private var bootedOTARecord: OTARecord?

    /// Ceiling for an OTA bundle. The app parses the whole source through
    /// QuickJS at launch, so a multi-MB bundle risks an out-of-memory kill on a
    /// memory-tight watch (the atomic write also needs ~2x transiently). Reject
    /// past this rather than persist something that can't load.
    private static let maxOTABundleBytes = 3 * 1024 * 1024

    /// Routes a generic invoke (SD-1) to its handler; an unknown method rejects
    /// (never hangs the JS Promise). A method whose feature the consumer's
    /// HostPolicy didn't authorize rejects POLICY_DENIED before any handler
    /// runs (ARCH-07).
    private func handleInvoke(id: Int, method: String, payload: String) {
        if let feature = HostInvokeFeatures.byMethod[method],
            !effectiveFeatures.contains(feature)
        {
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(
                    code: .policyDenied,
                    message: "method '\(method)' is blocked by this app's host "
                        + "policy — requires an app configuration change"))
            return
        }
        switch method {
        case "saveUpdate":
            handleSaveUpdate(id: id, payload: payload)
        case "getUpdateState":
            handleGetUpdateState(id: id)
        case "markUpdateHealthy":
            handleMarkUpdateHealthy(id: id)
        case "requestNotificationPermission":
            requestNotificationPermission(id: id)
        case "registerForRemoteNotifications":
            handleRegisterForRemoteNotifications(id: id)
        case "sendToPhone":
            sendToPhone(id: id, payload: payload)
        case "updateApplicationContext":
            settleConnectivity(id: id, connectivity.updateApplicationContext(payload))
        case "transferUserInfo":
            settleConnectivity(id: id, connectivity.transferUserInfo(payload))
        case "transferFile":
            handleTransferFile(id: id, payload: payload)
        case "cancelFileTransfer":
            settleConnectivity(id: id, connectivity.cancelFileTransfer(payload))
        case "outstandingFileTransfers":
            handleOutstandingFileTransfers(id: id)
        case "getConnectivityState":
            handleGetConnectivityState(id: id)
        case "deleteReceivedFile":
            settleConnectivity(id: id, connectivity.deleteReceivedFile(payload))
        case "readReceivedFile":
            handleReadReceivedFile(id: id, payload: payload)
        case "scheduleNotification":
            scheduleNotification(id: id, payload: payload)
        case "aiAvailability":
            aiAvailability(id: id)
        case "bleConnect":
            bluetooth.handleInvoke(id: id, method: method, payload: payload)
        case "bleWrite":
            bluetooth.handleInvoke(id: id, method: method, payload: payload)
        case "bleSubscribe":
            bluetooth.handleInvoke(id: id, method: method, payload: payload)
        case "getDeviceInfo":
            handleGetDeviceInfo(id: id)
        case "enableWaterLock":
            DeviceSnapshot.enableWaterLock()
            runtime?.resolveInvoke(id: id, resultJson: "null")
        case "scheduleBackgroundRefresh":
            handleScheduleBackgroundRefresh(id: id, payload: payload)
        case "startExtendedRuntimeSession":
            handleStartExtendedRuntimeSession(id: id)
        case "stopExtendedRuntimeSession":
            handleStopExtendedRuntimeSession(id: id)
        case "keychainSet":
            handleKeychainSet(id: id, payload: payload)
        case "keychainGet":
            handleKeychainGet(id: id, payload: payload)
        case "keychainDelete":
            handleKeychainDelete(id: id, payload: payload)
        case "speak":
            handleSpeak(id: id, payload: payload)
        case "stopSpeaking":
            handleStopSpeaking(id: id)
        case "playAudio":
            handlePlayAudio(id: id, payload: payload)
        case "stopAudio":
            handleStopAudio(id: id)
        case "getProducts":
            handleGetProducts(id: id, payload: payload)
        case "purchase":
            handlePurchase(id: id, payload: payload)
        case "currentEntitlements":
            handleCurrentEntitlements(id: id)
        case "restorePurchases":
            handleRestorePurchases(id: id)
        case "searchPOI":
            handleSearchPOI(id: id, payload: payload)
        case "getCurrentLocation":
            handleGetCurrentLocation(id: id)
        case "requestHealthAuthorization":
            handleRequestHealthAuthorization(id: id, payload: payload)
        case "queryHealthStatistics":
            handleQueryHealthStatistics(id: id, payload: payload)
        case "queryHealthDailyStatistics":
            handleQueryHealthDailyStatistics(id: id, payload: payload)
        case "queryHealthSamples":
            handleQueryHealthSamples(id: id, payload: payload)
        case "querySleepSamples":
            handleQuerySleepSamples(id: id, payload: payload)
        case "queryWorkoutHistory":
            handleQueryWorkoutHistory(id: id, payload: payload)
        case "requestCalendarAccess":
            handleRequestCalendarAccess(id: id, payload: payload)
        case "getCalendarEvents":
            handleGetCalendarEvents(id: id, payload: payload)
        case "getReminders":
            handleGetReminders(id: id, payload: payload)
        case "startWorkout":
            handleStartWorkout(id: id, payload: payload)
        case "pauseWorkout":
            handlePauseWorkout(id: id)
        case "resumeWorkout":
            handleResumeWorkout(id: id)
        case "endWorkout":
            handleEndWorkout(id: id, payload: payload)
        case "getWorkoutState":
            handleGetWorkoutState(id: id)
        case "requestWorkoutPlanAuthorization":
            handleRequestWorkoutPlanAuthorization(id: id)
        case "scheduleWorkoutPlan":
            handleScheduleWorkoutPlan(id: id, payload: payload)
        case "listScheduledWorkoutPlans":
            handleListScheduledWorkoutPlans(id: id)
        case "removeScheduledWorkoutPlan":
            handleRemoveScheduledWorkoutPlan(id: id, payload: payload)
        case "removeAllScheduledWorkoutPlans":
            handleRemoveAllScheduledWorkoutPlans(id: id)
        case "openWorkoutPlanInWorkoutApp":
            handleOpenWorkoutPlanInWorkoutApp(id: id, payload: payload)
        case "queryPedometer":
            handleQueryPedometer(id: id, payload: payload)
        default:
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(
                    code: .unknownMethod, message: "no invoke handler for \(method)"))
        }
    }

    /// OTA observability (review §6.11b): reports which bundle this launch
    /// actually booted — source/version/keyId/expiresAt + the anti-rollback
    /// high-water mark — so an app can ship fleet telemetry. JS merges the
    /// running bundle's content id (`__bundleReleaseId`) on its side.
    ///
    /// `healthSignal` + `bootAttempts` are the ARCH-04 pair: which policy this
    /// BINARY is on (a bundle can't know that on its own — the trust anchor is
    /// native, so `markUpdateHealthy()` looks identical either way) and how
    /// close this device is to a crash-loop rollback. Together they make
    /// "the fleet is on explicit, this device is on attempt 2" reportable.
    private func handleGetUpdateState(id: Int) {
        var result: [String: Any] = [
            "source": bootedOTARecord != nil ? "ota" : "shipped",
            "highWater": store.otaHighWater(),
            "healthSignal": updateHealthSignal == .explicit ? "explicit" : "commit",
            "bootAttempts": store.otaBootAttempts(),
        ]
        if let record = bootedOTARecord {
            if let version = record.version { result["version"] = version }
            if let keyId = record.keyId { result["keyId"] = keyId }
            if let expiresAt = record.expiresAt { result["expiresAt"] = expiresAt }
        }
        runtime?.resolveInvoke(id: id, resultJson: Self.jsonObject(result))
    }

    /// ARCH-04's explicit `bundleReady`: the running bundle confirming, after
    /// its own smoke checks, that this launch is healthy — the same blessing a
    /// committed tree performs under the default `.firstCommit` policy, routed
    /// through `markHealthy` so there is exactly one implementation. Under
    /// `.firstCommit` the commit handler already fired, so this is the no-op
    /// the `markedHealthyThisBoot` latch makes it. Always resolves: a bundle
    /// that calls it on a binary configured either way must behave the same.
    /// Runs on main (invoke dispatch is main-isolated), so no generation guard
    /// is needed — unlike the handlers that settle asynchronously.
    private func handleMarkUpdateHealthy(id: Int) {
        // `runApp()` → `render()` → `flushPassiveEffects()` all run
        // synchronously inside `js.evaluate`, which runs inside
        // `otaSequencer.boot()` — so a bundle that calls this from its module
        // body or a root mount effect arrives here while `bootedOTARecord` is
        // still nil. Blessing with nil clears the crash-loop counter WITHOUT
        // promoting the running bundle to known-good, and the latch then blocks
        // the commit path from ever doing it: the bundle is never snapshotted,
        // on every launch, forever. Park it until `load()` knows what booted.
        // `jsReady` is exactly the right discriminator — false for the whole of
        // `load(into:)`, true only after it returns.
        if !jsReady {
            pendingMarkHealthy = true
        } else if !markedHealthyThisBoot {
            markedHealthyThisBoot = true
            otaSequencer.markHealthy(bootedRecord: bootedOTARecord)
        }
        runtime?.resolveInvoke(id: id, resultJson: "null")
    }

    /// MapKit local POI search (MKLocalSearch): resolves the invoke with an
    /// array of {lat, lon, title, subtitle} for the natural-language `query`,
    /// biased to the optional region. An empty or failed SEARCH resolves to
    /// `[]` (not a rejection) so the UI just shows no pins — but a payload that
    /// isn't `{query: String, …}` is a malformed REQUEST and rejects: resolving
    /// `[]` for it made a caller bug indistinguishable from "no coffee near
    /// you". The completion is generation-guarded (CX-008) so a search settling
    /// after a dev-reload is dropped.
    private func handleSearchPOI(id: Int, payload: String) {
        guard let data = payload.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let query = obj["query"] as? String
        else {
            rejectInvalid(id: id, message: "searchPOI needs a string query")
            return
        }
        // The one branch that stays a resolve, per maps.ts's documented
        // contract ("an empty or failed search resolves to []").
        guard !query.isEmpty else {
            runtime?.resolveInvoke(id: id, resultJson: "[]")
            return
        }
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        if let lat = obj["latitude"] as? Double, let lon = obj["longitude"] as? Double {
            let span = obj["span"] as? Double ?? 0.1
            request.region = MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                span: MKCoordinateSpan(latitudeDelta: span, longitudeDelta: span))
        }
        let gen = generation
        MKLocalSearch(request: request).start { [weak self] response, _ in
            guard let self, gen == self.generation else { return }
            let items: [[String: Any]] = (response?.mapItems ?? []).prefix(15).map { item in
                var d: [String: Any] = [
                    "lat": item.placemark.coordinate.latitude,
                    "lon": item.placemark.coordinate.longitude,
                    "title": item.name ?? "",
                ]
                if let locality = item.placemark.locality { d["subtitle"] = locality }
                return d
            }
            let json =
                (try? JSONSerialization.data(withJSONObject: items))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
            self.runtime?.resolveInvoke(id: id, resultJson: json)
        }
    }

    /// Active one-shot location requests, retained (keyed by invoke id) until
    /// they settle. CLLocationManager needs a live delegate + run loop, so the
    /// request is created and its callbacks run on the main queue.
    @ObservationIgnored private var pendingLocations: [Int: OneShotLocation] = [:]

    /// One-shot current location (CLLocationManager.requestLocation): resolves
    /// {lat, lon} for centering a map / biasing a POI search, or rejects in the
    /// closed code set — PERMISSION_DENIED when the user (or a restriction)
    /// said no, UNAVAILABLE when no fix is obtainable. It used to reject a
    /// bespoke `LOCATION_UNAVAILABLE`, which no `InvokeErrorCode` comparison in
    /// JS could ever match. Generation-guarded.
    private func handleGetCurrentLocation(id: Int) {
        let gen = generation
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let request = OneShotLocation { [weak self] result in
                guard let self else { return }
                self.pendingLocations[id] = nil
                guard gen == self.generation else { return }
                switch result {
                case .success(let c):
                    self.runtime?.resolveInvoke(
                        id: id,
                        resultJson: Self.jsonObject(["lat": c.latitude, "lon": c.longitude]))
                case .failure(let error):
                    let denied = (error as? OneShotLocation.Failure) == .denied
                    self.runtime?.rejectInvoke(
                        id: id,
                        errorJson: Self.errorJSON(
                            code: denied ? .permissionDenied : .unavailable,
                            message: denied
                                ? "location permission denied"
                                : "current location unavailable"))
                }
            }
            self.pendingLocations[id] = request
        }
    }

    /// Runs the staging pipeline and *resolves* the invoke with a
    /// SaveUpdateResult (CX-005): a refusal (bad signature, capability gap,
    /// downgrade, write failure) is a normal `{accepted:false}` result — not an
    /// invoke rejection — so the reason reaches applyUpdate instead of
    /// vanishing. Staging (validator eval + bytecode compile) runs OFF the main
    /// thread (M5); the settle hops back to main, generation-guarded (CX-008).
    private func handleSaveUpdate(id: Int, payload: String) {
        let gen = generation
        Task { [weak self] in
            guard let self else { return }
            let outcome = await self.stageUpdate(payload)
            guard gen == self.generation else { return }
            switch outcome {
            case .accepted:
                self.runtime?.resolveInvoke(id: id, resultJson: #"{"accepted":true}"#)
            case .rejected(let reason):
                self.report(
                    code: "ota.saveRejected", severity: .recoverable,
                    subsystem: .ota, details: reason)
                let result: [String: Any] = [
                    "accepted": false, "code": "rejected", "message": reason,
                ]
                self.runtime?.resolveInvoke(id: id, resultJson: Self.jsonObject(result))
            }
        }
    }

    /// One SERIAL queue for all staging work: two concurrent saveUpdate
    /// invokes (or saveUpdate racing checkForUpdateNatively) must not
    /// interleave their gate-check → write sequences, or both could report
    /// `{accepted:true}` while the OLDER record lands last — the device would
    /// claim v6 applied but boot v5. Serializing whole stage() calls keeps
    /// acceptance reporting truthful. (boot() itself can't overlap a LIVE
    /// stage from the same runtime — saveUpdate only arrives from running JS,
    /// after load — and a stale pre-reload stage racing a dev-reload boot is
    /// benign: its settle is generation-dropped and its record is re-verified
    /// or re-offered on the next check.)
    private let otaStagingQueue = DispatchQueue(
        label: "react.watch.ota-staging", qos: .utility)

    /// Stages an OTA payload through the sequencer OFF the main thread (M5) —
    /// the validator eval and bytecode compile are the two heavyweight steps
    /// that used to run synchronously on main. The sequencer is Sendable
    /// (App-Group file IO + UserDefaults counters + throwaway runtimes).
    private func stageUpdate(_ payload: String) async -> StageOutcome {
        if updateKeyState == .disabled {
            print(
                "[ReactWatch] WARNING: persisting OTA bundle WITHOUT signature "
                    + "verification — set OTAConfig.signerPublicKeys to enforce (CR-4).")
        }
        let sequencer = otaSequencer
        return await withCheckedContinuation { continuation in
            otaStagingQueue.async {
                continuation.resume(returning: sequencer.stage(payload))
            }
        }
    }

    /// Requests notification permission and resolves the invoke with the real
    /// authorization status (CX-022) — resolved from getNotificationSettings, not
    /// the granted Bool (`.provisional` silently returns true). A native error
    /// rejects. Generation-guarded (CX-008).
    private func requestNotificationPermission(id: Int) {
        let gen = generation
        // `center` is re-fetched inside the completion rather than captured
        // from the outer scope: UNUserNotificationCenter isn't Sendable, and
        // capturing it into requestAuthorization's @Sendable completion (then
        // again into getNotificationSettings below) is exactly the
        // CalendarBridge isolation mistake (0b61c7d) one door over —
        // `.current()` is a cheap, thread-safe singleton lookup either way.
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) {
            [weak self] _, error in
            if let error {
                DispatchQueue.main.async {
                    guard let self, gen == self.generation else { return }
                    self.runtime?.rejectInvoke(
                        id: id,
                        errorJson: Self.errorJSON(
                            code: .internal, message: error.localizedDescription))
                }
                return
            }
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                let status = Self.permissionStatus(settings.authorizationStatus)
                DispatchQueue.main.async {
                    guard let self, gen == self.generation else { return }
                    self.runtime?.resolveInvoke(
                        id: id, resultJson: Self.jsonString(status))
                }
            }
        }
    }

    /// Invoke ids awaiting the APNs registration outcome, each stamped with
    /// the generation it was requested in. WatchKit has no completion handler
    /// for registerForRemoteNotifications — only the two WKApplicationDelegate
    /// callbacks — so the correlation lives here: ONE delegate callback
    /// settles every pending register call, and a callback landing after a
    /// dev-reload drops stale ids instead of settling the fresh runtime's
    /// reused id space (CX-008).
    @ObservationIgnored private var pendingRemotePushRegistrations: [(id: Int, generation: Int)] =
        []

    /// Invoke ids awaiting the extended-runtime session's start outcome, each
    /// stamped with the generation it was requested in AND the session epoch it
    /// belongs to. `WKExtendedRuntimeSession.start()` is asynchronous and has no
    /// completion handler — only the `extendedRuntimeSessionDidStart` /
    /// `didInvalidateWith` delegate callbacks — so the correlation lives here,
    /// like the APNs parking above. Unlike APNs, the identity is per-SESSION,
    /// not just per-generation: a terminal callback settles only the starts
    /// parked for the session it came from, so the previous session's late
    /// `invalidated` cannot reject a start parked for a new, still-healthy one.
    /// A callback landing after a dev-reload still drops stale ids instead of
    /// settling the fresh runtime's reused id space (CX-008).
    @ObservationIgnored
    private var pendingRuntimeSessionStarts: [(id: Int, generation: Int, epoch: Int)] = []

    /// The same parking for `startWorkout`, and for the same reason:
    /// `HKWorkoutSession.startActivity(with:)` is asynchronous with no
    /// completion handler — the outcome arrives on
    /// `workoutSession(_:didChangeTo:from:date:)` (-> .running) or
    /// `workoutSession(_:didFailWithError:)`. `generation` is the CX-008
    /// dev-reload guard; `epoch` is per-SESSION identity, so a previous
    /// session's late terminal callback cannot reject a start parked for a new,
    /// still-healthy one.
    @ObservationIgnored
    private var pendingWorkoutStarts: [(id: Int, generation: Int, epoch: Int)] = []

    /// Registers this launch with APNs and parks the invoke until the
    /// delegate reports the token (`remotePushDidRegister`) or the failure
    /// (`remotePushDidFail`). Tokens are per-launch (never cached), so JS
    /// calls this every launch; concurrent calls all settle on one callback.
    private func handleRegisterForRemoteNotifications(id: Int) {
        pendingRemotePushRegistrations.append((id: id, generation: generation))
        WKApplication.shared().registerForRemoteNotifications()
    }

    /// Settles a synchronous background-connectivity op: the two background
    /// channels (updateApplicationContext / transferUserInfo) hand off or fail
    /// immediately on the calling (main) thread — nil means handed to
    /// WCSession, an error rejects with its invoke code.
    private func settleConnectivity(id: Int, _ error: SendError?) {
        if let error {
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(code: error.code, message: error.message))
        } else {
            runtime?.resolveInvoke(id: id, resultJson: "")
        }
    }

    /// Sends a message to the paired iPhone and resolves the invoke with its
    /// reply, or rejects when unreachable / on a WCError (CX-022). The WCSession
    /// handlers fire on a background queue, so hop to main + generation-guard
    /// (CX-008) before settling.
    private func sendToPhone(id: Int, payload: String) {
        let gen = generation
        connectivity.send(payload) { [weak self] result in
            DispatchQueue.main.async {
                guard let self, gen == self.generation else { return }
                switch result {
                case .success(let replyJson):
                    self.runtime?.resolveInvoke(id: id, resultJson: replyJson)
                case .failure(let error):
                    self.runtime?.rejectInvoke(
                        id: id,
                        errorJson: Self.errorJSON(
                            code: error.code, message: error.message))
                }
            }
        }
    }

    /// Queues a file for the paired iPhone and resolves the bridge-minted id
    /// ONCE QUEUED — the transfer itself is throttled by the system, survives
    /// suspension, and can complete in a later launch, so parking the invoke on
    /// delivery (the `startExtendedRuntimeSession` shape) would blow the 30 s
    /// watchdog on every call. Completion rides `watchConnectivity.fileTransfer`.
    ///
    /// The soft size budget WARNS and still transfers, the ARCH-13 posture:
    /// WCError — not our unmeasured number — is the authority on what is
    /// actually too large for WatchConnectivity.
    private func handleTransferFile(id: Int, payload: String) {
        switch connectivity.transferFile(payload) {
        case .failure(let error):
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(code: error.code, message: error.message))
        case .success(let queued):
            for diagnostic in budgets.check(
                transferFileBytes: queued.bytes, sessionId: sessionId,
                releaseId: bootedReleaseId, target: .watch)
            {
                report(diagnostic)
            }
            runtime?.resolveInvoke(
                id: id, resultJson: Self.jsonObject(["id": queued.id]))
        }
    }

    private func handleOutstandingFileTransfers(id: Int) {
        let entries = connectivity.outstandingTransfers()
        let json =
            (try? JSONSerialization.data(withJSONObject: entries))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        runtime?.resolveInvoke(id: id, resultJson: json)
    }

    private func handleGetConnectivityState(id: Int) {
        runtime?.resolveInvoke(
            id: id, resultJson: Self.jsonObject(connectivity.connectivityState()))
    }

    /// Reads one chunk of a received file. Settles SYNCHRONOUSLY on main, like
    /// the other inbox op: this is a local flash read bounded by
    /// `FileInbox.maxReadBytes`, with no daemon, no network and no permission
    /// sheet in the way — the CalendarBridge queue hop exists because Apple
    /// documents `events(matching:)` as slow, which is not this. The cost of a
    /// ceiling-sized chunk (read + base64 + JSON) is stated on the JS wrapper
    /// so a caller can choose smaller chunks rather than discover the pause.
    private func handleReadReceivedFile(id: Int, payload: String) {
        switch connectivity.readReceivedFile(payload) {
        case .success(let chunk):
            runtime?.resolveInvoke(id: id, resultJson: Self.jsonObject(chunk))
        case .failure(let error):
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(code: error.code, message: error.message))
        }
    }

    /// Maps UNAuthorizationStatus to the JS NotificationPermission string
    /// (js/src/notifications.ts). `.ephemeral` (App Clips, not watch) is treated
    /// as granted; anything unknown is reported as unavailable.
    ///
    /// `nonisolated`, and that is load-bearing the same way as
    /// CalendarBridge.json (0b61c7d): the class-level `@MainActor` would
    /// otherwise implicitly isolate this pure switch too, and its one call
    /// site runs inside `getNotificationSettings`'s completion — off-main,
    /// not @Sendable-audited by UNUserNotificationCenter today, so it's a
    /// warning rather than the hard error CalendarBridge hit under Xcode
    /// 26.6. Safe in fact (pure function, Sendable arg/result); `internal`
    /// so `NotificationPermissionTests` can pin it directly.
    nonisolated static func permissionStatus(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized: "granted"
        case .denied: "denied"
        case .notDetermined: "notDetermined"
        case .provisional: "provisional"
        case .ephemeral: "granted"
        @unknown default: "unavailable"
        }
    }

    /// JSON-encodes a {code, message} reject payload, escaping safely — the
    /// shared builder so every bridge produces identical, always-valid JSON.
    /// `code` is the closed `InvokeErrorCode` enum, so a handler can't invent a
    /// code JS would have to cast through unchecked.
    private static func errorJSON(code: InvokeErrorCode, message: String) -> String {
        InvokeErrorJSON.make(code: code, message: message)
    }

    /// JSON-encodes an object for an invoke result/error, escaping safely.
    private static func jsonObject(_ object: [String: Any]) -> String {
        (try? JSONSerialization.data(withJSONObject: object))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    /// JSON-encodes a bare string as an invoke result (e.g. a status enum).
    private static func jsonString(_ value: String) -> String {
        (try? JSONSerialization.data(
            withJSONObject: value, options: .fragmentsAllowed
        ))
        .flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
    }

    /// Remote manifest served at `OTAConfig.manifestURL` ({version, bundle,
    /// signature}); `bundle` is absolute or relative to the manifest URL.
    private struct RemoteManifest: Decodable {
        let version: Int
        let bundle: String
        let signature: String?
        let keyId: String?
        let expiresAt: Int?
    }

    /// Native OTA recovery for the hard gate (CR-17): when stale JS is blocked
    /// the JS app isn't running to fetch an update, so fetch the manifest +
    /// bundle natively, stage it through the same verified `saveUpdate` gate,
    /// and reboot to apply. Used by `UpdateRequiredView`'s button.
    func checkForUpdateNatively() async {
        guard let urlString = updateManifestURL, let url = URL(string: urlString) else {
            report(
                code: "ota.noManifestURL", severity: .recoverable,
                subsystem: .ota, details: "no update URL configured")
            return
        }
        // Same transport policy as the JS update flow (review §6.11c): https
        // required, plain http only for loopback/private-LAN dev hosts.
        if let violation = UpdateURLPolicy.violation(of: urlString) {
            report(
                code: "ota.insecureURL", severity: .recoverable,
                subsystem: .ota, details: violation)
            return
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let manifest = try JSONDecoder().decode(RemoteManifest.self, from: data)
            guard let bundleURL = URL(string: manifest.bundle, relativeTo: url) else {
                report(
                    code: "ota.badManifest", severity: .recoverable,
                    subsystem: .ota, details: "update manifest has no bundle URL")
                return
            }
            // The manifest's `bundle` may be absolute — check the RESOLVED
            // URL too, or a cleartext bundle rides in on an https manifest.
            if let violation = UpdateURLPolicy.violation(of: bundleURL.absoluteString) {
                report(
                    code: "ota.insecureURL", severity: .recoverable,
                    subsystem: .ota, details: violation)
                return
            }
            let (jsData, _) = try await URLSession.shared.data(from: bundleURL)
            // Enforce the size cap BEFORE materializing a String — saveUpdate
            // checks it too, but only after this path has already doubled the
            // allocation for a hostile/erroneous manifest's bundle (NF-33).
            guard jsData.count <= Self.maxOTABundleBytes else {
                report(
                    code: "ota.bundleTooLarge", severity: .recoverable,
                    subsystem: .ota,
                    details: "update bundle is \(jsData.count) bytes — over "
                        + "the \(Self.maxOTABundleBytes)-byte limit")
                return
            }
            guard let js = String(data: jsData, encoding: .utf8) else {
                report(
                    code: "ota.bundleNotUTF8", severity: .recoverable,
                    subsystem: .ota, details: "update bundle was not UTF-8 text")
                return
            }
            var payload: [String: Any] = ["js": js, "version": manifest.version]
            if let signature = manifest.signature { payload["signature"] = signature }
            if let keyId = manifest.keyId { payload["keyId"] = keyId }
            if let expiresAt = manifest.expiresAt { payload["expiresAt"] = expiresAt }
            guard let payloadData = try? JSONSerialization.data(withJSONObject: payload),
                let payloadString = String(data: payloadData, encoding: .utf8)
            else { return }
            if case .rejected(let reason) = await stageUpdate(payloadString) {
                report(
                    code: "ota.saveRejected", severity: .recoverable,
                    subsystem: .ota, details: reason)
                return
            }
            boot()  // re-load; the staged bundle (>= high-water) now runs
        } catch {
            report(
                code: "ota.checkFailed", severity: .recoverable, subsystem: .ota,
                details: "update check failed: \(error.localizedDescription)")
        }
    }

    private struct GenerateRequest: Decodable {
        let prompt: String
        let instructions: String?
        let temperature: Double?
        /// Optional cap on the model's response length (GenerationOptions
        /// .maximumResponseTokens), from js/src/ai.ts GenerateOptions.maxTokens.
        let maxTokens: Int?
    }

    /// Resolves the invoke with whether on-device AI can run now (CX-002):
    /// `SystemLanguageModel.default.isAvailable` on watchOS 27+, else `false`.
    /// On an older SDK FoundationModels isn't in the watch SDK, so this compiles
    /// to the `false` fallthrough — building the real query needs Xcode 27.
    private func aiAvailability(id: Int) {
        #if canImport(FoundationModels)
        if #available(watchOS 27.0, *) {
            let available = SystemLanguageModel.default.isAvailable
            runtime?.resolveInvoke(id: id, resultJson: available ? "true" : "false")
            return
        }
        #endif
        runtime?.resolveInvoke(id: id, resultJson: "false")
    }

    /// On-device text generation via Foundation Models (js/src/ai.ts).
    private func generate(id: Int, requestJson: String) {
        guard
            let req = try? JSONDecoder().decode(
                GenerateRequest.self, from: Data(requestJson.utf8)
            )
        else {
            runtime?.rejectGenerate(id: id, message: "bad request")
            return
        }
        #if canImport(FoundationModels)
        // Foundation Models' LanguageModelSession is watchOS 27.0+ (Apple docs;
        // it's 26.0 on iOS/macOS but only reached the watch at 27.0, in beta) —
        // the gate was wrongly 26.0 (CX-002). Building this path needs the
        // watchOS 27 SDK (Xcode 27); on an older SDK FoundationModels isn't in
        // the watch SDK, so this whole block compiles out and generate() rejects
        // below with "on-device AI unavailable".
        if #available(watchOS 27.0, *) {
            let gen = generation
            Task { [weak self] in
                do {
                    let session = LanguageModelSession(
                        instructions: req.instructions ?? ""
                    )
                    var options = GenerationOptions()
                    if let t = req.temperature { options.temperature = t }
                    if let max = req.maxTokens { options.maximumResponseTokens = max }
                    let response = try await session.respond(
                        to: req.prompt, options: options
                    )
                    await MainActor.run {
                        guard let self, gen == self.generation else { return }
                        self.runtime?.resolveGenerate(id: id, text: response.content)
                    }
                } catch {
                    await MainActor.run {
                        guard let self, gen == self.generation else { return }
                        self.runtime?.rejectGenerate(
                            id: id, message: error.localizedDescription
                        )
                    }
                }
            }
            return
        }
        #endif
        runtime?.rejectGenerate(id: id, message: "on-device AI unavailable")
    }

    /// How many times the OTA bundle may boot without reaching a healthy commit
    /// before it's rolled back to shipped (ARCH-04 crash-loop guard).
    private static let maxOTABootAttempts = 3

    /// Delegates the boot decision + fallback chain (anti-rollback, crash-loop
    /// recovery, bytecode trust, high-water bumps) to the Linux-tested
    /// sequencer (M5); this shell just binds the eval closures to the live
    /// runtime and maps the outcome onto the published UI state.
    private func load(into js: JSRuntime) throws {
        // Set the moment an OTA artifact starts evaluating into `js`. From then
        // on this context is no longer pristine: whatever the bundle managed to
        // run at module scope before it threw is still in there. The sequencer
        // only ever calls the shipped eval AFTER the OTA evals (pinned by
        // `testFallbackShippedEvalRunsLastWithTheBudgetAlreadyCleared`), so
        // reading the flag inside `evalShipped` sees the final answer.
        var otaEvalStarted = false
        let outcome: BootOutcome
        do {
            outcome = try otaSequencer.boot(
                evalSource: { source in
                    self.disposeActiveRoot(in: js)
                    otaEvalStarted = true
                    self.setBundleReleaseId(source, into: js)
                    try js.evaluate(source)
                },
                evalBytecode: { bytecode, source in
                    self.disposeActiveRoot(in: js)
                    otaEvalStarted = true
                    self.setBundleReleaseId(source, into: js)
                    try js.evaluateBytecode(bytecode)
                },
                evalShipped: {
                    // The whole point of ARCH-08's last gap: if an OTA bundle
                    // ran in `js` and failed, the shipped bundle must NOT be
                    // evaluated on top of its leftovers.
                    let target: JSRuntime
                    if otaEvalStarted {
                        target = try self.replaceRuntimeAfterPoisonedOTA()
                    } else {
                        target = js
                    }
                    try self.loadShipped(into: target)
                }
            )
        } catch let failure as OTABootSequencer.BootFailure {
            // Shipped ALSO failed after an OTA detour: surface why the OTA
            // isn't running (the notice) alongside the fatal startup
            // diagnostic the caller reports from the rethrow — matching
            // pre-M5 behavior, where the notice was surfaced at the catch
            // site before trying shipped.
            if let notice = failure.notice {
                report(
                    code: "ota.bootNotice", severity: .recoverable,
                    subsystem: .ota, details: notice)
            }
            throw failure.underlying
        }
        switch outcome {
        case .ranOTA(let record, let notice):
            bootedOTARecord = record
            // Rollback / crash-loop notices ride in `notice` — recoverable so
            // the banner shows them, and in the ring for rollback forensics.
            if let notice {
                report(
                    code: "ota.bootNotice", severity: .recoverable,
                    subsystem: .ota, details: notice)
            }
        case .ranShipped(let notice):
            if let notice {
                report(
                    code: "ota.bootNotice", severity: .recoverable,
                    subsystem: .ota, details: notice)
            }
        case .blockForUpdate(let notice):
            // A poisoned OTA eval reaches this outcome too, and `evalShipped`
            // — the only other caller of the swap — is NOT called on the way:
            // when the failed candidate is dropped, the sequencer re-runs the
            // policy with no candidate, and a shipped bundle below the
            // high-water mark returns `.blockForUpdate` BEFORE `evalShipped`
            // (pinned by `testBootFailedCandidateReRunsPolicyAndHardGateBlocks`,
            // whose shipped-eval count is 0). Without this the half-executed
            // bundle would stay the app's live runtime for the whole session
            // while the UI says "update required": its armed timers keep
            // firing, `pushNativeEvent` (scenePhase/sensors/connectivity/push)
            // keeps feeding it, and every foreground `reconcileWidgets()`
            // evaluates its `__republishWidgets` into the App Group — the
            // opposite of what blocking is for. `try?`, not `try`: the throw
            // means only that a REPLACEMENT runtime couldn't be built; the
            // poisoned one is already down and `runtime` nil by then, which is
            // the right end state for a boot that runs no JS, and it must not
            // turn the update-required screen into a fatal startup error.
            if otaEvalStarted { _ = try? replaceRuntimeAfterPoisonedOTA() }
            // Hard gate: every available bundle is older than one already
            // applied — refuse to boot stale JS so it can't write to a
            // newer-schema db; show the native "update required" screen.
            // `updateRequired` itself stays a plain state flag (it is a state,
            // not an error); the notice explains WHY in the ring + banner.
            if let notice {
                report(
                    code: "ota.updateRequired", severity: .recoverable,
                    subsystem: .ota, details: notice)
            }
            updateRequired = true
        }
        // ARCH-04: resolve the health policy for this boot now that the booted
        // record is known — once, off the commit path (it reads the known-good
        // record from the App Group to spot an already-blessed bundle). This
        // one line is also what recomputes the policy for a FRESH-runtime
        // fallback boot: the OTA outcome never landed, so `bootedOTARecord` is
        // still nil and both health policies self-bless the shipped bundle
        // (`commitBlesses(bootedRecord: nil)` is pinned true under `.explicit`
        // by `testExplicitPolicyStillSelfBlessesShippedBoots`). It runs before
        // any commit can be processed — commits cross `decodeQueue` and this is
        // the main thread — so no commit is ever judged by a stale policy.
        commitBlessesHealth = otaSequencer.commitBlesses(bootedRecord: bootedOTARecord)
        // A blessing parked by `handleMarkUpdateHealthy` during eval IS the
        // explicit confirmation — apply it now that the record it blesses is
        // known, so it promotes the running bundle to known-good instead of
        // just clearing the counter. Deliberately after `commitBlesses` so the
        // policy for this boot is still decided from the booted record alone.
        // On the fallback path the flag can only belong to the SHIPPED bundle:
        // `replaceRuntimeAfterPoisonedOTA` discarded the dead bundle's.
        if pendingMarkHealthy, !markedHealthyThisBoot {
            markedHealthyThisBoot = true
            otaSequencer.markHealthy(bootedRecord: bootedOTARecord)
        }
    }

    /// Exposes the loaded bundle's content id to JS (CX-025) so `checkForUpdate`
    /// can compare it to the server manifest's `releaseId` and detect a
    /// non-breaking fix that kept the same `version`. The id is FNV-1a hex
    /// (matching the build's `contentHash`), set BEFORE the bundle runs.
    /// Also recorded as `bootedReleaseId` so diagnostics carry the identity
    /// of the bundle that produced them (ARCH-13).
    private func setBundleReleaseId(_ source: String, into js: JSRuntime) {
        let releaseId = ContentHash.of(source)
        bootedReleaseId = releaseId
        try? js.evaluate(
            "globalThis.__bundleReleaseId='\(releaseId)';",
            filename: "release-id.js")
    }

    /// Replaces the runtime a poisoned OTA evaluation ran in, so the shipped
    /// fallback boots into a context that bundle never touched (ARCH-08's last
    /// gap, closed).
    ///
    /// `disposeActiveRoot` releases the failed bundle's ROOT, but a bundle that
    /// threw partway through its module body has already run arbitrary code in
    /// this context, and none of it hangs off the root: `setTimeout`s it armed,
    /// `registerWidget`/`registerIntent` entries, a started inspector with its
    /// one-way `console` tee, and every module singleton it initialised. There
    /// is no hook that could release those — the only complete answer is to
    /// throw the context away. This path exists to survive a bad bundle, and
    /// running the shipped bundle on a hostile-or-broken one's leftovers is not
    /// surviving it.
    ///
    /// Throws only if the fresh runtime can't be built (a QuickJS allocation
    /// failure); the sequencer then wraps it as a `BootFailure` and `boot()`
    /// reports a fatal startup diagnostic — loud, which is right: there is no
    /// runtime left to run anything in.
    private func replaceRuntimeAfterPoisonedOTA() throws -> JSRuntime {
        // Same teardown, same order, as a reload — the poisoned bundle could
        // have started native work from its module body (a fetch, a sensor
        // stream, a BLE connect, speech/audio, an extended-runtime session),
        // and every one of those settles or pushes into `self.runtime`, which
        // is about to be the FRESH runtime. This also does the generation bump
        // the fallback needs (below), and frees QuickJS on its owning queue.
        //
        // The generation bump is NOT redundant with the one `boot()` already
        // did: `boot()` bumps once per boot, and this retry happens INSIDE one
        // boot call, so without a second bump the dead bundle's parked
        // callbacks would carry exactly the generation the fresh runtime is
        // created under and every CX-008 guard would wave them through.
        // `shutdown()` cancels the old context's timers, but nothing cancels a
        // URLSession completion, an MKLocalSearch callback, a notification-add
        // callback or a StoreKit task the poisoned module body kicked off —
        // those are host closures that outlive the context and settle BY ID.
        // The fresh bundle's id spaces restart at 1, so an id minted by the
        // dead bundle can name a live promise in the new one: the exact
        // collision CX-008 exists for. The bump must also precede
        // `makeRuntime()`, because the `js.onError` closure captures the
        // generation at construction time.
        //
        // That capture is also why the failed bundle's OWN diagnostics need
        // rescuing across it: `js.onError` hops to main and we are still ON
        // main inside `boot()`, so every job-throw / unhandled rejection its
        // module body queued is undrained right now and the guard would drop
        // it the instant `generation` moves. Record the outgoing pair first —
        // the release id is still the dead bundle's here, and `bootedReleaseId`
        // is cleared a few lines below.
        poisonedGeneration = generation
        poisonedGenerationReleaseId = bootedReleaseId
        tearDownGeneration()
        // ...but NOT its BLE carve-out. `tearDownGeneration` leaves the
        // connection up and `BleSession.takeAllPending()` keeps
        // `desiredSubscriptions`, because on a dev hot-reload the SAME app's
        // next bundle wants the link back. Here there is no such consumer: the
        // bundle that called bleConnect/bleSubscribe from its module body is
        // dead and rejected. Left up, `finishDiscovery` re-applies ITS
        // subscriptions on any rediscovery, and `onNotify`/`onState` — wired
        // once in `start()` and name-routed through `self.runtime` with no
        // generation capture, so the CX-008 bump does not stop them — deliver
        // ble.notify/ble.state into the recovery bundle, which asked for
        // neither. AFTER the teardown on purpose: `runtime` is nil by then, so
        // the drain's rejects and the synchronous "disconnected" push are
        // no-ops instead of settling into a dying context. `endByUser()` also
        // latches `userInitiatedDisconnect`, which neutralizes the reconnect
        // window `resetPendingForReload` may have just re-armed; a recovery
        // bundle's own `bleConnect` clears the latch, so BLE stays usable.
        bluetooth.disconnect()
        // The dead bundle's parked `markUpdateHealthy()` must NOT survive into
        // the shipped boot. `handleMarkUpdateHealthy` parks while `jsReady` is
        // false, which is the whole of `load()` — so without this reset the
        // flag `load()` reads at the end would be ambiguous: it could be the
        // shipped bundle confirming itself, or the poisoned bundle's
        // confirmation applied to a boot it never survived. Blessing a boot
        // with a dead bundle's word is a lie even when (as today, the
        // sequencer having just zeroed the crash-loop counter) the resulting
        // `markHealthy` is a no-op — and it would additionally latch
        // `markedHealthyThisBoot`, silently suppressing the shipped bundle's
        // own blessing on its first healthy commit.
        pendingMarkHealthy = false
        // Diagnostics emitted from here on must not be stamped with the
        // identity of a bundle that is no longer running (ARCH-13); the
        // caller's `loadShipped` sets the shipped id as its first act.
        bootedReleaseId = nil
        // NOT reset here, and each for a reason: `bootedOTARecord` is still nil
        // (only the `.ranOTA` outcomes populate it, and this boot's OTA threw),
        // so `commitBlesses` at the end of `load()` recomputes as the
        // shipped-boot self-bless under BOTH health policies;
        // `markedHealthyThisBoot`/`reconciledThisBoot`/`root`/`ackedSeq` are
        // only ever written from the commit handler, which hops through
        // `decodeQueue` and cannot land while this main-thread boot is still
        // running — and is dropped by the generation bump above when it does.
        return try installFreshRuntime()
    }

    /// Disposes whatever root is mounted in `js` before the SAME bundle is
    /// re-evaluated into that context (ARCH-08). `runApp`'s single-root guard
    /// only spans one evaluation — the bundle is an IIFE, so a second
    /// `evaluate` gets a fresh module scope on a context whose globals survive,
    /// and the guard cannot see the previous evaluation's root.
    ///
    /// What still re-evaluates in place is the bytecode→source retry, in both
    /// `evalOTA` and `loadShipped`: a `.qbc` that fails to load falls back to
    /// parsing the source of the very same bundle. The CROSS-bundle case — a
    /// failed OTA followed by the shipped bundle — no longer reuses a context
    /// at all (`replaceRuntimeAfterPoisonedOTA`), so on that path this call is
    /// a no-op against a pristine runtime.
    ///
    /// A no-op when nothing is mounted, and best-effort by design: a bundle
    /// that never reached `runApp` has no hook, and a throwing dispose must not
    /// block the recovery boot this call precedes.
    private func disposeActiveRoot(in js: JSRuntime) {
        try? js.evaluate(
            "globalThis.__disposeActiveRoot?.()", filename: "dispose-root.js")
    }

    private func loadShipped(into js: JSRuntime) throws {
        // Read the source up front for the release id (CX-025), even when the
        // precompiled bytecode runs below — so JS always learns its content id.
        let source = Bundle.main.url(forResource: "bundle", withExtension: "js")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
        if let source { setBundleReleaseId(source, into: js) }

        // OP-1: trust `bundle.qbc` only when its stamped hash (tools/qjs-compile
        // writes `bundle.hash` = ContentHash.of(bundle.js) next to it) matches
        // the source we just read. Blindly preferring the bytecode — the old
        // behavior — silently booted a STALE compiled bundle over a
        // hand-swapped bundle.js (the documented dev flow of editing the
        // source and re-running the app without recompiling bytecode); it bit
        // this project twice in one session. See ContentHash.matches.
        if let source,
            let qbc = Bundle.main.url(forResource: "bundle", withExtension: "qbc"),
            let data = try? Data(contentsOf: qbc)
        {
            let stampedHash = Bundle.main.url(forResource: "bundle", withExtension: "hash")
                .flatMap { try? String(contentsOf: $0, encoding: .utf8) }?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if ContentHash.matches(source: source, stampedHash: stampedHash) {
                do {
                    disposeActiveRoot(in: js)
                    try js.evaluateBytecode(data)
                    return
                } catch {
                    report(
                        code: "boot.bytecodeFallback", severity: .info,
                        subsystem: .boot,
                        details: "bytecode load failed, using bundle.js: \(error)")
                }
            } else {
                report(
                    code: "boot.bytecodeStale", severity: .info,
                    subsystem: .boot,
                    details: "bundle.qbc does not match bundle.js's content hash "
                        + "(stale or hand-copied bytecode) — parsing bundle.js instead")
            }
        }
        guard let code = source else {
            throw JSRuntime.JSError.exception("bundle.js missing — run `npm run build`")
        }
        disposeActiveRoot(in: js)
        try js.evaluate(code)
    }

    private func makeRuntime() throws -> JSRuntime {
        // Cap the app's QuickJS heap so a runaway/oversized bundle fails loudly
        // inside the engine instead of getting the whole app OOM-jetsammed
        // (OP-3). Generous vs the widget's 16MB — the app has the full UI tree.
        // allowedFeatures (ARCH-07): only policy-authorized features' host
        // functions are installed, so JS typeof detection matches the policy.
        let js = try JSRuntime(
            memoryLimitBytes: 64 * 1024 * 1024,
            allowedFeatures: effectiveFeatures)
        js.useJSCallBridge = useJSCallBridge  // CR-5 A/B selector
        js.bridge.commit = { [weak self] json in
            guard let self else { return }
            // Capture the generation this commit was emitted under: the tree is
            // decoded on a background queue, and a reload meanwhile would swap the
            // runtime. Without this guard the stale tree would clobber the new
            // runtime's root and advance its ack (CX-008) — the one async settle
            // that was missing the guard every other one has.
            let gen = self.generation
            self.decodeQueue.async { [weak self] in
                // Byte count off main (it's O(payload), like the decode
                // it precedes); the budget verdict hops back with the tree.
                let bytes = json.utf8.count
                let decoded = try? self?.treeDecoder.decode(
                    RNTree.self, from: Data(json.utf8)
                )
                DispatchQueue.main.async { [weak self] in
                    guard let self, gen == self.generation else { return }
                    // Budget tripwire BEFORE the decode/wire guards: an
                    // oversized payload should leave evidence even when it
                    // also fails to decode.
                    for diagnostic in self.budgets.check(
                        commitJSONBytes: bytes, sessionId: self.sessionId,
                        releaseId: self.bootedReleaseId, target: .watch)
                    {
                        self.report(diagnostic)
                    }
                    guard let tree = decoded else {
                        self.report(
                            code: "commit.decodeFailed", severity: .recoverable,
                            subsystem: .commit, details: "tree decode failed")
                        return
                    }
                    // The JS bundle and this native target version evolve
                    // independently; a wire-version mismatch means the tree may
                    // mis-decode. Surface it loudly (once) and REJECT the commit
                    // — don't let an incompatible tree reach the interpreter or
                    // advance the optimistic ack (CX-009).
                    if tree.v != RNWire.version {
                        if !self.warnedWireMismatch {
                            self.warnedWireMismatch = true
                            self.report(
                                code: "wire.versionMismatch", severity: .fatal,
                                subsystem: .wire,
                                details: "wire version mismatch: bundle "
                                    + "v\(tree.v) vs runtime v\(RNWire.version) "
                                    + "— rebuild the bundle")
                        }
                        return
                    }
                    // Equality guard (NF-22): even with @Observable's
                    // per-property tracking, assigning an identical tree would
                    // still invalidate every reader of `root` — skip ack-only /
                    // value-identical commits (high-frequency sensor pushes).
                    if self.root != tree.root {
                        self.root = tree.root
                    }
                    // A committed tree means the bundle booted healthily — clear
                    // the crash-loop counter so only *boot* failures accumulate
                    // (ARCH-04), and snapshot the running OTA bundle as the
                    // known-good rollback target. Once per boot: after the first
                    // healthy commit this was a semantic no-op that still read
                    // UserDefaults on every commit (10-20/sec under sensors).
                    // Under OTAConfig.healthSignal == .explicit a commit is NOT
                    // proof for an unproven OTA bundle — only its own
                    // markUpdateHealthy() call is (commitBlessesHealth, decided
                    // once at boot so this stays two bool reads per commit).
                    if !self.markedHealthyThisBoot, self.commitBlessesHealth {
                        self.markedHealthyThisBoot = true
                        self.otaSequencer.markHealthy(bootedRecord: self.bootedOTARecord)
                    }
                    // ARCH-06 reconciliation, once per boot. The first
                    // committed tree is the earliest moment JS is proven able
                    // to render — before it, `__republishWidgets` either
                    // doesn't exist yet or would publish from a half-built
                    // tree. Same once-per-boot shape (and reason) as the
                    // markHealthy call above: it reads the App Group.
                    if !self.reconciledThisBoot {
                        self.reconciledThisBoot = true
                        self.reconcileWidgets()
                    }
                    if tree.seq > self.ackedSeq {
                        self.ackedSeq = tree.seq
                        // Calling a mutating method registers an observation
                        // WRITE on `optimistic` even when it early-returns —
                        // gate on isEmpty so ack-only commits (the common
                        // case) don't invalidate every control that read it.
                        if !self.optimistic.isEmpty {
                            self.optimistic.ack(throughSeq: tree.seq)
                        }
                    }
                }
            }
        }
        js.bridge.publishWidgets = { [weak self, store] json in
            // Read the outgoing payload BEFORE the save overwrites it: the
            // reload gate below compares against what the extension would
            // currently decode.
            let previous = store.publishedWidgetsJSON()
            // The save is immediate — published data must never be lost — but
            // the extension wake is coalesced (P1-3): a burst of publishes (a
            // tap streak, a subscription firing) collapses to ONE
            // reloadAllTimelines instead of waking the widget extension per
            // call and burning the WidgetKit refresh budget.
            store.save(json)
            // ARCH-06 follow-up 3: a republish whose only difference is
            // `publishedAt` (an unchanged reconcile, a write that no widget
            // reads) would spend a refresh-budget wake to hand the extension a
            // payload it already has. The SAVE still happened — freshness
            // bookkeeping must stay current — only the wake is skipped.
            let changed = WidgetPublishGate.shouldReload(
                previousJSON: previous, newJSON: json)
            guard let self else {
                if changed { WidgetCenter.shared.reloadAllTimelines() }
                return
            }
            // The payload just went to the store carrying the revision it was
            // rendered against, so the batch is closed: the NEXT mutation must
            // move the revision past it (ARCH-06). Unconditional — it is about
            // what was STORED, not about who gets woken.
            self.revisionTracker.closeBatch()
            guard changed else { return }
            self.scheduleWidgetReload()
        }
        js.bridge.getItem = { [store] in store.getItem($0) }
        js.bridge.setItem = { [weak self, store] key, value in
            self?.noteStateWrite()
            store.setItem(key, value)
        }
        js.bridge.counterGet = { [counters] in counters.value(forKey: $0) }
        js.bridge.counterAdd = { [weak self, counters] key, delta, min, max in
            self?.noteStateWrite()
            return counters.add(delta, toKey: key, min: min, max: max)
        }
        js.bridge.stateRevision = { [weak self, revisionCounter] in
            // A read means a payload is being STAMPED against this value, so
            // the batch closes here too (ARCH-06). Without this the rule would
            // be "the revision moves on the first write since the last
            // PUBLICATION", and a write landing after the sample — a `render()`
            // callback writing Storage while a batch opened by an earlier write
            // is still open — would bump nothing: the payload would be stamped
            // equal to the live revision and read `.current` over state it was
            // computed before. The honest rule is "the revision moves on the
            // first write after the last sample-or-publication".
            self?.revisionTracker.closeBatch()
            return revisionCounter.value(forKey: StateRevisionTracker.key)
        }
        js.bridge.fetch = { [weak self] id, reqJson in
            self?.performFetch(id: id, requestJson: reqJson)
        }
        js.bridge.abortFetch = { [weak self] id in self?.abortFetch(id: id) }
        js.bridge.ble = { [weak self] json in self?.bluetooth.handleOp(json) }
        js.bridge.sensor = { [weak self] json in self?.sensors.handleOp(json) }
        js.bridge.invoke = { [weak self] id, method, payload in
            self?.handleInvoke(id: id, method: method, payload: payload)
        }
        js.bridge.generate = { [weak self] id, reqJson in
            self?.generate(id: id, requestJson: reqJson)
        }
        // Capture the generation NOW (makeRuntime runs under the boot that
        // just bumped it): reading it when the error fires would see the new
        // generation after a swap and defeat the guard (CX-008 / NF-14).
        let gen = generation
        js.onError = { [weak self] source, message in
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                // ...with ONE exception: the runtime a poisoned OTA eval ran
                // in. `replaceRuntimeAfterPoisonedOTA()` bumps mid-boot while
                // these blocks are still queued, so a plain generation compare
                // would silently discard the failed bundle's own async cause
                // and leave only the sequencer's one-line notice, which names
                // the rethrow site. Those errors ARE the rollback forensics.
                // They are stamped with the dead bundle's release id, never the
                // shipped one that replaced it (ARCH-13).
                let fromPoisoned = gen == self.poisonedGeneration
                guard gen == self.generation || fromPoisoned else { return }
                // subsystem .js is recorded + bannered but NOT pushed back
                // into JS (echo-loop protection, see report()).
                self.report(
                    Diagnostic(
                        code: "js.\(source)", severity: .recoverable,
                        subsystem: .js, sessionId: self.sessionId,
                        releaseId: fromPoisoned
                            ? self.poisonedGenerationReleaseId
                            : self.bootedReleaseId,
                        target: .watch, details: message))
            }
        }
        js.bridge.playHaptic = { type in
            let haptic: WKHapticType =
                switch type {
                case "success": .success
                case "failure": .failure
                case "notification": .notification
                case "directionUp": .directionUp
                case "directionDown": .directionDown
                case "start": .start
                case "stop": .stop
                case "retry": .retry
                default: .click
                }
            WKInterfaceDevice.current().play(haptic)
        }
        js.bridge.cancelNotification = { id in
            UNUserNotificationCenter.current()
                .removePendingNotificationRequests(withIdentifiers: [id])
        }
        return js
    }

    /// Schedules a local notification and settles the invoke (CX-022): a native
    /// `UNUserNotificationCenter.add` failure rejects so it reaches JS instead of
    /// vanishing; success resolves. Decode + trigger-time math is
    /// ReactWatchSupport.NotificationPlan (unit-tested on Linux); the host just
    /// builds the request. The add callback fires on a background queue, so hop
    /// to main + generation-guard (CX-008) before settling.
    private func scheduleNotification(id: Int, payload: String) {
        guard let plan = NotificationPlan(json: payload) else {
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(
                    code: .invalidRequest, message: "bad notification payload"))
            return
        }
        let content = UNMutableNotificationContent()
        content.title = plan.title
        content.body = plan.body
        if plan.sound { content.sound = .default }
        let request = UNNotificationRequest(
            identifier: plan.id,
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(
                timeInterval: plan.triggerSeconds, repeats: false
            )
        )
        let gen = generation
        UNUserNotificationCenter.current().add(request) { [weak self] error in
            DispatchQueue.main.async {
                guard let self, gen == self.generation else { return }
                if let error {
                    self.runtime?.rejectInvoke(
                        id: id,
                        errorJson: Self.errorJSON(
                            code: .internal, message: error.localizedDescription))
                } else {
                    self.runtime?.resolveInvoke(id: id, resultJson: "null")
                }
            }
        }
    }

    /// Returns the seq assigned to this dispatch; optimistic controls
    /// compare it against ackedSeq to know when React has caught up.
    @discardableResult
    func dispatch(nodeId: Int, event: String, payload: [String: Any]? = nil) -> Int {
        let seq = nextSeq
        nextSeq += 1
        runtime?.dispatchEvent(
            nodeId: nodeId, event: event, payload: payload, seq: seq
        )
        return seq
    }

    /// Forwards a native state push (connectivity, lifecycle, sensors) into
    /// React at urgent priority — commits instantly, like a tap.
    func pushNativeEvent(_ name: String, payload: [String: Any]? = nil) {
        runtime?.pushNativeEvent(name, payload: payload)
    }

    /// Last Always-On luminance state the root view observed. Kept so a fresh
    /// JS generation can be told it at boot — see `pushLuminanceReduced`.
    @ObservationIgnored private var luminanceReduced = false

    /// The root view's `.onChange(of: isLuminanceReduced, initial: true)` sink.
    /// A pure push event: no host method, no invoke, no HostPolicy feature —
    /// like `scenePhase`, `openURL` and `backgroundRefresh`, none of which are
    /// policy-gated either.
    func setLuminanceReduced(_ reduced: Bool) {
        luminanceReduced = reduced
        pushLuminanceReduced()
    }

    /// Pushes the CURRENT luminance state to whatever JS generation is live.
    ///
    /// Called from `boot()` as well as from the environment change, and that
    /// second call site is the point: `pushNativeEvent` reaches nobody while
    /// `jsReady == false` (there is no `__pushNativeEvent` global before the
    /// bundle evaluates), and SwiftUI does not order `.onChange(initial:)`
    /// against `.onAppear { model.start() }`. Without the re-push the initial
    /// value races the runtime and is silently dropped — and an OTA hot-reload
    /// would never learn the state at all, because the wrist has not moved.
    private func pushLuminanceReduced() {
        pushNativeEvent("luminanceReduced", payload: ["reduced": luminanceReduced])
    }

    /// Trailing-edge debounce for the widget-extension wake (P1-3). Main-
    /// confined like the bridge callbacks that schedule it.
    @ObservationIgnored private var widgetReloadDebounce: DispatchWorkItem?

    private func scheduleWidgetReload() {
        widgetReloadDebounce?.cancel()
        // The item clears its own reference when it RUNS — otherwise a later
        // background flush would find the executed-but-still-referenced item
        // (cancel() no-ops post-execution) and fire a spurious extra
        // reloadAllTimelines at suspension time, wasting the exact budget this
        // debounce protects.
        let work = DispatchWorkItem { [weak self] in
            self?.widgetReloadDebounce = nil
            WidgetCenter.shared.reloadAllTimelines()
        }
        widgetReloadDebounce = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: work)
    }

    /// Fire a pending debounced reload NOW — called on background so a publish
    /// just before suspension isn't left waiting for a timer that won't run
    /// until the app is next foregrounded (the widget would show stale data all
    /// that time).
    private func flushPendingWidgetReload() {
        guard let work = widgetReloadDebounce else { return }
        widgetReloadDebounce = nil
        work.cancel()
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Moves the App-Group state revision for the first write of this mutation
    /// batch (ARCH-06).
    ///
    /// ORDER IS THE WHOLE POINT: this runs BEFORE the write lands. A crash
    /// between the bump and the write leaves the revision AHEAD of the data, so
    /// any payload published from it reads as stale — a spurious recompute,
    /// which is safe. The reverse order (write, then bump) would let a payload
    /// read CURRENT while the state it describes had already moved: exactly the
    /// bug ARCH-06 exists to close. Fail-stale is the only acceptable
    /// direction, so the bump must never be reordered after the store call.
    private func noteStateWrite() {
        guard revisionTracker.needsBump() else { return }
        revisionCounter.add(
            1, toKey: StateRevisionTracker.key, min: 0, max: .max)
    }

    /// ARCH-06 reconciliation: republish when the payload on the face was
    /// derived from a different state revision than the App Group now holds.
    ///
    /// That gap is what a crash between mutation and publication leaves behind
    /// — the write survived, the publication didn't — and nothing else would
    /// ever close it: the app doesn't re-render widgets on its own, and the
    /// extension only re-renders when WidgetKit asks. JS owns rendering, so
    /// this asks rather than fabricating a payload; `__republishWidgets` is
    /// optional-called, so a bundle that registers no widgets is a no-op.
    ///
    /// A missing payload counts as a mismatch: never-published is exactly the
    /// state a republish fixes.
    private func reconcileWidgets() {
        // Nothing to reconcile when the payload cannot be persisted: with no App
        // Group (or `widgets` denied by ARCH-07 policy) `save` is a no-op, so
        // `published` stays nil against revision 0 and the mismatch below would
        // republish — and log an info diagnostic into the 50-entry forensic ring
        // — on every single foreground, without ever converging.
        guard store.appGroupId != nil, effectiveFeatures.contains("widgets")
        else { return }
        let published = store.loadPublishedWidgets()?.stateRevision
        let current = revisionCounter.value(forKey: StateRevisionTracker.key)
        // The payload now in the store may have been published by the WIDGET
        // EXTENSION (a control intent, or renderFreshTimelines saving its own
        // render). That closes the mutation batch for the SHARED store, but this
        // process's tracker only ever sees its own writes — so the next local
        // write would skip the bump and leave that foreign payload reading
        // `.current` while state had moved, with nothing able to detect it.
        // Close the batch on any observed publication: an extra bump is
        // fail-stale (one spurious republish), the safe direction.
        //
        // Residual: a foreign publication landing while the app is in the
        // FOREGROUND with an open batch is still not observed. That is a much
        // narrower window (control taps and WidgetKit renders overwhelmingly
        // happen while the app is not frontmost); closing it fully needs the
        // recorded 2-phase pending/committed follow-up.
        revisionTracker.closeBatch()
        guard published != current else { return }
        report(
            code: "widgets.reconcile", severity: .info, subsystem: .widgets,
            details: "published revision \(published.map(String.init) ?? "none")"
                + " != state revision \(current) — republishing")
        try? runtime?.evaluate(
            "globalThis.__republishWidgets?.()", filename: "reconcile.js")
    }

    /// scenePhase teardown backstop (P0-3). A backgrounded app is not unmounted,
    /// so JS effect/focus cleanups never fire on background — native must stop
    /// the high-drain heart-rate workout session (unless the app opted into
    /// background HR) and restart it on foreground. `sensors` is private, so the
    /// scenePhase handler routes through here.
    func handleScenePhase(background: Bool) {
        if background {
            sensors.pauseForBackground()
            flushPendingWidgetReload()
        } else {
            sensors.resumeFromForeground()
            // ARCH-06: while the app was away, a control intent running in the
            // widget extension may have mutated shared state, and a payload
            // published from THIS process is now stale. Foreground is the
            // cheapest place to notice (the app is awake and rendering
            // anyway); mismatch → republish.
            reconcileWidgets()
        }
    }

    /// Runs a JS fetch over URLSession; settles the Promise back on main.
    /// Request parsing + response assembly are ReactWatchSupport (FetchPlan /
    /// FetchResponse), tested on Linux; the host only orchestrates URLSession.
    private func performFetch(id: Int, requestJson: String) {
        guard let plan = FetchPlan(json: requestJson) else {
            runtime?.rejectFetch(id: id, message: "invalid fetch request")
            return
        }
        let gen = generation
        let task = URLSession.shared
            .dataTask(with: plan.request) { [weak self] data, response, error in
                DispatchQueue.main.async {
                    guard let self, gen == self.generation else { return }
                    self.fetchTasks[id] = nil
                    if let error {
                        if (error as NSError).code != NSURLErrorCancelled {
                            self.runtime?.rejectFetch(
                                id: id, message: error.localizedDescription
                            )
                        }
                        return
                    }
                    let http = response as? HTTPURLResponse
                    var headers: [String: String] = [:]
                    http?.allHeaderFields.forEach { key, value in
                        // Repeated headers (e.g. Set-Cookie) arrive as an array;
                        // WHATWG joins them with ", ", not Swift's "[a, b]"
                        // array description.
                        let joined =
                            (value as? [Any]).map { array in
                                array.map { "\($0)" }.joined(separator: ", ")
                            } ?? "\(value)"
                        headers["\(key)".lowercased()] = joined
                    }
                    let status = http?.statusCode ?? 0
                    let url = http?.url?.absoluteString ?? plan.url
                    switch FetchResponse.classifyBody(data) {
                    case .tooLarge(let bytes, let limit):
                        // Don't bridge an unbounded body into the watch's tight
                        // QuickJS heap — fail loud instead of risking OOM.
                        self.runtime?.rejectFetch(
                            id: id,
                            message: "response body too large: \(bytes) bytes "
                                + "exceeds \(limit)-byte limit"
                        )
                    case .text(let text):
                        self.runtime?.resolveFetch(
                            id: id,
                            responseJson: FetchResponse.json(
                                status: status, url: url, body: text,
                                headers: headers
                            )
                        )
                    case .base64(let encoded):
                        // Binary body — carried as base64 so it isn't silently
                        // dropped (the old UTF-8 decode turned it into "").
                        self.runtime?.resolveFetch(
                            id: id,
                            responseJson: FetchResponse.json(
                                status: status, url: url, body: encoded,
                                headers: headers, bodyEncoding: "base64"
                            )
                        )
                    }
                }
            }
        fetchTasks[id] = task
        task.resume()
    }

    private func abortFetch(id: Int) {
        fetchTasks[id]?.cancel()
        fetchTasks[id] = nil
    }

    /// Dispatches an event and remembers `value` as the node's optimistic
    /// value until React acks this dispatch — the release is the guaranteed
    /// seq-ack, so a handler that DECLINES the change (keeps its state) still
    /// snaps native back instead of leaving it diverged.
    func dispatchOptimistic(
        nodeId: Int, value: JSONValue, payload: [String: Any],
        event: String = "change"
    ) {
        let seq = dispatch(nodeId: nodeId, event: event, payload: payload)
        optimistic.set(nodeId: nodeId, seq: seq, value: value)
    }

    /// The ARCH-09 navigation transaction: proposes `path` to JS as a seq'd
    /// `pathChange` and synchronously returns the structured verdict. On
    /// accept, the path is held optimistically (same release model as
    /// dispatchOptimistic: the guaranteed seq-ack — which can't land before
    /// this returns, the commit crosses the decode queue first — drops it once
    /// the confirming tree is in). On decline, or no verdict at all (missing
    /// handler, thrown JS error, no runtime — parse maps those to rollback),
    /// nothing is stored, so the stack binding keeps reading the committed
    /// path and native never animates the refused push.
    @discardableResult
    func dispatchNavigation(nodeId: Int, path: [String]) -> DispatchResult {
        let seq = nextSeq
        nextSeq += 1
        let payloadJson = (try? JSONEncoder().encode(["path": path]))
            .flatMap { String(data: $0, encoding: .utf8) }
        let result = DispatchResult.parse(
            runtime?.dispatchEventReturning(
                nodeId: nodeId, event: "pathChange",
                payloadJson: payloadJson, seq: seq))
        if result.accepted {
            optimistic.set(
                nodeId: nodeId, seq: seq,
                value: .array(path.map(JSONValue.string)))
        }
        return result
    }

    func optimisticBool(_ nodeId: Int) -> Bool? {
        optimistic.bool(nodeId)
    }

    func optimisticInt(_ nodeId: Int) -> Int? {
        optimistic.int(nodeId)
    }

    func optimisticDouble(_ nodeId: Int) -> Double? {
        optimistic.double(nodeId)
    }

    func optimisticString(_ nodeId: Int) -> String? {
        optimistic.string(nodeId)
    }

    func optimisticStringArray(_ nodeId: Int) -> [String]? {
        optimistic.stringArray(nodeId)
    }

    #if DEBUG
    /// The dev-server bundle URL a DEBUG build polls (the `react-watchos dev`
    /// contract). Overridable via the `ReactWatchDevServerURL` Info.plist key
    /// (M11) — a physical watch needs the Mac's LAN IP, not localhost.
    private static let devBundleURL: URL = {
        if let s = Bundle.main.object(
            forInfoDictionaryKey: "ReactWatchDevServerURL") as? String,
            let url = URL(string: s)
        {
            return url
        }
        return URL(string: "http://127.0.0.1:8788/bundle.js")!
    }()
    @ObservationIgnored private var devTask: Task<Void, Never>?
    @ObservationIgnored private var lastDevBundle: String?

    /// The dev-reload poll is the one thing that outlived this model. The task
    /// captures `[weak self]` — so there is no retain cycle and nothing kept
    /// the model alive — but nobody cancelled it either, so after the model
    /// went away the loop kept waking every 2 s to hit the dev server forever.
    /// DEBUG-only, exactly like the loop it cancels.
    deinit {
        devTask?.cancel()
    }

    private func startDevReload() {
        guard devTask == nil else { return }
        devTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                await self?.pollDevServer()
            }
        }
    }

    private func pollDevServer() async {
        var request = URLRequest(url: Self.devBundleURL)
        request.timeoutInterval = 1.5
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, _) = try? await URLSession.shared.data(for: request),
            let code = String(data: data, encoding: .utf8),
            !code.isEmpty, code != lastDevBundle
        else { return }
        let isFirstFetch = lastDevBundle == nil
        lastDevBundle = code
        if !isFirstFetch {
            boot(devCode: code)
        }
    }
    #endif
}

/// OTA verification + rollback policy for `ReactWatchRootView` (CR-4 / CR-17).
public struct OTAConfig: Sendable {
    /// Trusted OTA signing keys (CX-007): `keyId -> base64 Ed25519 public key`.
    /// Empty = OTA saves are REFUSED unless `allowUnsignedUpdates` is set
    /// (NF-29 secure default); set keys to enforce signed updates +
    /// anti-rollback. Multiple entries enable key rotation — trust `{old, new}`
    /// while you migrate signing to `new`, then
    /// drop `old` in a later app release (rotate-then-revoke with an overlap
    /// window so no device is stranded). This map ships INSIDE the code-signed
    /// app binary: it's the trust anchor, so it must never come from a source
    /// the OTA channel could mutate.
    public var signerPublicKeys: [String: String]
    /// `.hard` refuses to boot a bundle older than the newest applied (protects
    /// the db from stale JS); `.soft` runs it and lets the app prompt to update.
    public var gate: OTAGate
    /// Compatibility version of the bundle shipped in the app binary. Bump it in
    /// lockstep with the shipped bundle, only on a breaking change (db schema /
    /// wire contract); it anchors the anti-rollback boot decision.
    public var shippedVersion: Int
    /// Update manifest endpoint (`{version, bundle, signature}`). Lets the hard
    /// gate's "Check for update" recover natively — re-fetching a current bundle
    /// when stale JS is blocked and the JS app isn't running to fetch. HTTPS.
    public var manifestURL: String?
    /// Explicit dev opt-in to load UNSIGNED OTA bundles when no keys are
    /// configured (NF-29). Never ship a release build with this set: anyone
    /// who can answer the manifest URL gets the full host surface. Ignored
    /// once `signerPublicKeys` is non-empty — keys always enforce.
    public var allowUnsignedUpdates: Bool
    /// What proves an OTA bundle healthy (ARCH-04's `bundleReady`), so the
    /// crash-loop counter clears and the bundle is promoted to known-good.
    ///
    /// `.firstCommit` (default): the first committed tree is the proof. Cheap
    /// and needs nothing from the bundle, but it can't tell a correct screen
    /// from a blank one or an error fallback, and a bundle that renders and
    /// *then* reliably dies resets the counter on every launch, so it never
    /// reaches the rollback threshold.
    ///
    /// `.explicit`: only the bundle's own `markUpdateHealthy()` call blesses
    /// it — put it after your smoke checks (first screen rendered, session
    /// restored, whatever "working" means for your app), never at module top
    /// level.
    ///
    /// ⚠️ There is no timer and no grace period: the boot counter IS the
    /// enforcement. **Opting into `.explicit` and shipping an OTA bundle that
    /// never calls `markUpdateHealthy()` rolls that bundle back after 3
    /// launches** (`maxOTABootAttempts`), to the previous known-good bundle or
    /// to shipped. Flip this flag and ship the calling bundle together.
    ///
    /// Two boots bless themselves regardless, because the explicit bar is only
    /// meaningful for an OTA bundle that hasn't proved itself: the SHIPPED
    /// bundle (inside this signed binary — it has nothing to confirm), and an
    /// OTA bundle that is ALREADY the known-good snapshot (so flipping this
    /// flag can't retroactively condemn a bundle that predates the API).
    ///
    /// The policy lives here — in the code-signed binary — and never in the
    /// bundle, for the same reason `signerPublicKeys` does: a bundle that
    /// could relax its own health bar would declare itself trustworthy.
    public var healthSignal: OTAHealthSignal

    public init(
        signerPublicKeys: [String: String] = [:], gate: OTAGate = .soft,
        shippedVersion: Int = 1, manifestURL: String? = nil,
        allowUnsignedUpdates: Bool = false,
        healthSignal: OTAHealthSignal = .firstCommit
    ) {
        self.signerPublicKeys = signerPublicKeys
        self.gate = gate
        self.shippedVersion = shippedVersion
        self.manifestURL = manifestURL
        self.allowUnsignedUpdates = allowUnsignedUpdates
        self.healthSignal = healthSignal
    }
}

/// Shown by the hard update gate (CR-17) when stale JS is refused, so it never
/// runs against a newer-schema db. Native, because the JS app isn't booted in
/// this state; recovery (re-fetching a current bundle) is wired separately.
private struct UpdateRequiredView: View {
    @Environment(ReactWatchModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                Image(systemName: "arrow.down.circle").font(.title2)
                Text("Update required").font(.headline)
                Text("A newer version is needed to run safely.")
                    .font(.footnote).multilineTextAlignment(.center)
                Button("Check for update") {
                    Task { await model.checkForUpdateNatively() }
                }
                if let error = model.latestRecoverable?.message {
                    Text(error).font(.caption2).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding()
        }
    }
}

/// The watch UI. Embed this in your @main App's scene; ship bundle.js as a
/// resource. `appGroupId` enables shared widget/Storage state (optional); `ota`
/// configures signed-update verification + anti-rollback (CR-4 / CR-17).
/// `useJSCallBridge` selects the Swift→JS bridge (CR-5): the default `JS_Call`
/// path or, set to `false`, the legacy eval path — set it per launch (e.g. a
/// random bucket) to A/B them on-device before the eval path is retired.
/// `policy` is the ARCH-07 host policy: which features a bundle MAY use out of
/// what this binary CAN back (`.allowAll` = everything; "core" is always on).
/// Blocked features vanish from `__host`/`__hostFeatures`, invoke calls to
/// them reject POLICY_DENIED, and OTA staging refuses bundles requiring them.
public struct ReactWatchRootView: View {
    @State private var model: ReactWatchModel
    @Environment(\.scenePhase) private var scenePhase
    /// Always-On: true when the user lowers their wrist and the display stays
    /// on at reduced luminance (watchOS 8+ keeps your view visible by default).
    ///
    /// Read HERE, once, and never in `NodeView`: NodeView is instantiated per
    /// node, so reading the environment there would fan one global signal out
    /// across the whole tree and re-evaluate every node's body on every
    /// wrist-down — the opposite of what this signal exists to save.
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    public init(
        appGroupId: String? = nil, ota: OTAConfig = .init(),
        useJSCallBridge: Bool = true, policy: HostPolicy = .allowAll
    ) {
        _model = State(
            initialValue: ReactWatchModel(
                appGroupId: appGroupId, ota: ota,
                useJSCallBridge: useJSCallBridge, policy: policy
            ))
    }

    public var body: some View {
        Group {
            if model.updateRequired {
                UpdateRequiredView()
            } else if let root = model.root {
                // Screens own their scrolling (ScrollView/List nodes).
                NodeView(node: root)
            } else if let error = model.startupError {
                ScrollView {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            } else {
                ProgressView()
            }
        }
        .overlay(alignment: .bottom) {
            // Developer-facing banner: the latest RECOVERABLE diagnostic
            // (ARCH-13). Fatal boot failures take the full-screen path above;
            // info-severity diagnostics stay in the ring/log only.
            if let error = model.latestRecoverable?.message {
                ScrollView {
                    Text(error)
                        .font(.footnote.monospaced())
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(6)
                }
                .frame(maxHeight: 120)
                .background(.red.opacity(0.85), in: .rect(cornerRadius: 8))
                .onTapGesture { model.latestRecoverable = nil }
            }
        }
        .environment(model)
        .onAppear { model.start() }
        .onChange(of: scenePhase) { _, phase in
            model.pushNativeEvent("scenePhase", payload: ["phase": "\(phase)"])
            // Native teardown backstop: stop the high-drain HR workout session on
            // background, resume on foreground. JS effect cleanups don't fire on
            // background (the app isn't unmounted), so native owns this.
            switch phase {
            case .background: model.handleScenePhase(background: true)
            case .active: model.handleScenePhase(background: false)
            default: break
            }
        }
        // `initial: true` (watchOS 10.0, exactly the floor) is half of the
        // answer to the initial-value problem: a plain .onChange fires only on
        // CHANGE, so a bundle that mounts while the wrist is already down would
        // believe luminance is normal and keep its timers running — precisely
        // the failure this signal exists to prevent. The other half is the
        // re-push at the end of boot(), because this push lands before the
        // bundle has evaluated (pushNativeEvent is inert until then) and
        // SwiftUI does not guarantee this fires after .onAppear's model.start().
        // BOTH are needed; neither is redundant.
        .onChange(of: isLuminanceReduced, initial: true) {
            model.setLuminanceReduced(isLuminanceReduced)
        }
        .onOpenURL { url in
            model.pushNativeEvent("openURL", payload: ["url": url.absoluteString])
        }
    }
}

/// The package's WKApplicationDelegate: forwards a fired background-refresh
/// task to JS (`onBackgroundRefresh`) and the remote-push (APNs) callbacks to
/// `ReactWatchRemotePush`. Wire it in your @main App with
/// `@WKApplicationDelegateAdaptor(ReactWatchAppDelegate.self)` — the
/// `react-watchos scaffold` command writes this for you. Without it,
/// `scheduleBackgroundRefresh` still schedules the wake, but the fire event
/// never reaches JS (a scenePhase `active` wake does), and
/// `registerForRemoteNotifications` never settles.
public final class ReactWatchAppDelegate: NSObject, WKApplicationDelegate {
    public override init() { super.init() }

    public func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        // WatchKit delivers background tasks on the main thread; deliver to JS
        // SYNCHRONOUSLY (a pushNativeEvent commit), THEN complete the task, so
        // watchOS doesn't suspend mid-commit.
        for task in backgroundTasks {
            if let refresh = task as? WKApplicationRefreshBackgroundTask {
                let userInfo = Self.decodeUserInfo(refresh.userInfo)
                MainActor.assumeIsolated {
                    ReactWatchModel.shared?.deliverBackgroundRefresh(userInfo: userInfo)
                }
            }
            // No snapshot: we changed no UI directly (JS republishes widgets).
            task.setTaskCompletedWithSnapshot(false)
        }
    }

    public func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) {
        MainActor.assumeIsolated {
            ReactWatchRemotePush.didRegister(deviceToken: deviceToken)
        }
    }

    public func didFailToRegisterForRemoteNotificationsWithError(_ error: any Error) {
        MainActor.assumeIsolated {
            ReactWatchRemotePush.didFail(error: error)
        }
    }

    public func didReceiveRemoteNotification(
        _ userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (WKBackgroundFetchResult) -> Void
    ) {
        // Delivered on the main thread like the other WatchKit callbacks; the
        // JS delivery is synchronous, so complete immediately with its verdict.
        MainActor.assumeIsolated {
            completionHandler(ReactWatchRemotePush.didReceive(userInfo))
        }
    }

    /// The userInfo we scheduled with is carried as a JSON NSString (see
    /// handleScheduleBackgroundRefresh); decode it back to a dictionary.
    private static func decodeUserInfo(_ raw: NSSecureCoding?) -> [String: Any]? {
        guard let json = raw as? NSString,
            let data = (json as String).data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return obj
    }
}

/// Remote-push (APNs) forwarding for an app with its OWN WKApplicationDelegate
/// (scaffolded apps already wire `ReactWatchAppDelegate`, which calls these):
/// forward the three delegate callbacks here and the package settles JS's
/// `registerForRemoteNotifications()` and feeds `onRemotePush` /
/// `onRemotePushToken` / `onRemotePushRegistrationError`. Nil-safe before the
/// model exists: token/failure are dropped (nothing is listening yet) and
/// `didReceive` reports `.noData`.
@MainActor
public enum ReactWatchRemotePush {
    /// Forward from `didRegisterForRemoteNotifications(withDeviceToken:)`.
    public static func didRegister(deviceToken: Data) {
        ReactWatchModel.shared?.remotePushDidRegister(deviceToken: deviceToken)
    }

    /// Forward from `didFailToRegisterForRemoteNotificationsWithError(_:)`.
    public static func didFail(error: any Error) {
        ReactWatchModel.shared?.remotePushDidFail(error: error)
    }

    /// Forward from `didReceiveRemoteNotification(_:fetchCompletionHandler:)`
    /// and pass the returned value to the completion handler.
    public static func didReceive(
        _ userInfo: [AnyHashable: Any]
    ) -> WKBackgroundFetchResult {
        ReactWatchModel.shared?.remotePushDidReceive(userInfo) ?? .noData
    }
}

// MARK: - Capability invoke handlers (device/background/runtime/keychain/
// speech/iap). Same-file extension so the generation guard (private) is
// visible; the native bits live in CapabilityBridges.swift.
extension ReactWatchModel {
    func handleGetDeviceInfo(id: Int) {
        runtime?.resolveInvoke(
            id: id, resultJson: Self.jsonObject(DeviceSnapshot.current()))
    }

    func handleScheduleBackgroundRefresh(id: Int, payload: String) {
        let fields = Self.decodeObject(payload)
        // `?? 0` used to turn a missing/misnamed afterMs into "wake me RIGHT
        // NOW" — a battery-budget request the developer never made, silently
        // spending one of watchOS's ~hourly refresh grants and, for a caller
        // that reschedules from its own fire handler, doing it in a loop.
        guard let afterMs = fields["afterMs"] as? Double else {
            rejectInvalid(
                id: id,
                message: "scheduleBackgroundRefresh needs afterMs (ms from now)")
            return
        }
        let date = Date().addingTimeInterval(max(0, afterMs) / 1000)
        // userInfo must be (NSSecureCoding & NSObjectProtocol)?: carry the JSON
        // userInfo as an NSString so it round-trips to the fire event verbatim.
        var info: (NSSecureCoding & NSObjectProtocol)?
        if let userInfo = fields["userInfo"],
            let data = try? JSONSerialization.data(withJSONObject: userInfo),
            let json = String(data: data, encoding: .utf8)
        {
            info = json as NSString
        }
        let gen = generation
        WKApplication.shared().scheduleBackgroundRefresh(
            withPreferredDate: date, userInfo: info
        ) { [weak self] error in
            DispatchQueue.main.async {
                guard let self, gen == self.generation else { return }
                if let error {
                    self.runtime?.rejectInvoke(
                        id: id,
                        errorJson: Self.errorJSON(
                            code: .internal, message: error.localizedDescription))
                } else {
                    self.runtime?.resolveInvoke(id: id, resultJson: "null")
                }
            }
        }
    }

    /// Delivery hook for a fired background refresh -> JS `onBackgroundRefresh`.
    /// Called by ReactWatchAppDelegate.handle(_:) when watchOS runs a task
    /// scheduled by `scheduleBackgroundRefresh` (wire the adaptor in @main App).
    func deliverBackgroundRefresh(userInfo: [String: Any]?) {
        pushNativeEvent("backgroundRefresh", payload: ["userInfo": userInfo ?? [:]])
    }

    /// APNs registration succeeded: resolve every pending register invoke of
    /// the current generation with the lowercase-hex token (stale generations
    /// drop, CX-008) and publish `remotePush.token` for passive listeners —
    /// the callback can also arrive with nothing pending (a consumer's own
    /// native register call). The event push is jsReady-gated like the
    /// diagnostic push: pre-boot there is no `__pushNativeEvent` global and
    /// no listener could exist yet.
    func remotePushDidRegister(deviceToken: Data) {
        let hex = RemotePushWire.hexToken(deviceToken)
        let pending = pendingRemotePushRegistrations
        pendingRemotePushRegistrations = []
        for entry in pending where entry.generation == generation {
            runtime?.resolveInvoke(id: entry.id, resultJson: Self.jsonString(hex))
        }
        if jsReady {
            pushNativeEvent("remotePush.token", payload: ["token": hex])
        }
    }

    /// APNs registration failed (missing aps-environment entitlement, no
    /// network, sandbox mismatch): reject the pending register invokes —
    /// UNAVAILABLE, because the fix is configuration/environment, not the
    /// user — and publish `remotePush.registrationError` for listeners.
    func remotePushDidFail(error: any Error) {
        let message = error.localizedDescription
        let pending = pendingRemotePushRegistrations
        pendingRemotePushRegistrations = []
        for entry in pending where entry.generation == generation {
            runtime?.rejectInvoke(
                id: entry.id,
                errorJson: Self.errorJSON(code: .unavailable, message: message))
        }
        if jsReady {
            pushNativeEvent("remotePush.registrationError", payload: ["message": message])
        }
    }

    /// Delivers a remote notification's userInfo to JS as `remotePush` and
    /// maps the outcome to the WKBackgroundFetchResult the delegate must
    /// report: a listener consumed it -> .newData, otherwise .noData — no
    /// runtime, JS not booted yet (a cold-launch background push arrives
    /// before the bundle evaluates; v1 drops it), or no listener registered.
    /// Synchronous (the push commits like a tap), so the delegate completes
    /// far inside the system's 30 s wall-clock budget.
    func remotePushDidReceive(_ userInfo: [AnyHashable: Any]) -> WKBackgroundFetchResult {
        guard let runtime, jsReady else { return .noData }
        return runtime.pushNativeEventReturning(
            "remotePush", payload: RemotePushWire.sanitize(userInfo))
            ? .newData : .noData
    }

    /// Starts an extended runtime session and PARKS the invoke until the
    /// session's own lifecycle reports the outcome — `extendedRuntime.ts`
    /// promises "Resolves when it becomes running; rejects if the system
    /// declines (already active, or unsupported session type)", and resolving
    /// `"null"` the instant `start()` returned delivered none of that:
    /// `WKExtendedRuntimeSession.start()` is asynchronous, and the
    /// already-active case early-returned and still reported success.
    ///
    /// "Already active" is settled here because it is the one refusal that
    /// produces no delegate callback; everything else settles in
    /// `settleRuntimeSessionStarts`.
    func handleStartExtendedRuntimeSession(id: Int) {
        guard extendedRuntime.start() else {
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(
                    code: .unavailable,
                    message: "an extended runtime session is already active"))
            return
        }
        pendingRuntimeSessionStarts.append(
            (id: id, generation: generation, epoch: extendedRuntime.epoch))
    }

    /// Settles the parked `startExtendedRuntimeSession`s that belong to the
    /// session this callback came from (`epoch`), in the current generation,
    /// from its terminal-ish states: `running` resolves, `invalidated` rejects
    /// UNAVAILABLE with the system's reason — which is what a consumer who
    /// forgot the Info.plist runtime-session reason actually hits, and what
    /// used to look like a successful start.
    /// A `stopExtendedRuntimeSession` before the session started invalidates
    /// it, so the pending start rejects rather than hanging to its watchdog.
    ///
    /// Keying on the session, not just the generation, is what stops a stop-
    /// then-restart from rejecting a HEALTHY session: `stop()` clears the
    /// bridge's reference synchronously and resolves the stop invoke on the
    /// same main-thread work item, so JS restarting on that resolve parks its
    /// id before the old session's queued `invalidated` block ever runs. With
    /// only a generation to compare, that block rejected the new session's
    /// start ("the extended runtime session was invalidated: …") while the
    /// session was running, and the later `running` callback found nothing
    /// left to resolve. Starts parked on OTHER sessions stay parked.
    /// Stale generations drop (CX-008); `boot()`'s `stop(silent:)` detaches the
    /// delegate, so a reload produces no callback here at all.
    private func settleRuntimeSessionStarts(
        state: String, reason: String?, epoch: Int
    ) {
        guard state == "running" || state == "invalidated" else { return }
        let pending = pendingRuntimeSessionStarts
        pendingRuntimeSessionStarts = pending.filter {
            $0.generation == generation && $0.epoch != epoch
        }
        for entry in pending
        where entry.generation == generation && entry.epoch == epoch {
            if state == "running" {
                runtime?.resolveInvoke(id: entry.id, resultJson: "null")
            } else {
                runtime?.rejectInvoke(
                    id: entry.id,
                    errorJson: Self.errorJSON(
                        code: .unavailable,
                        message: "the extended runtime session was invalidated: "
                            + (reason ?? "unknown reason")))
            }
        }
    }

    func handleStopExtendedRuntimeSession(id: Int) {
        // Settle BEFORE resolving the stop: `stop()` reports the epoch it just
        // ended, so the starts parked on that session drain on THIS turn, and
        // the JS that restarts on the stop's resolve parks under a fresh epoch
        // the old session's late `invalidated` can no longer touch. A stop with
        // no live session reports 0 and settles nothing.
        let stopped = extendedRuntime.stop()
        settleRuntimeSessionStarts(
            state: "invalidated", reason: "the session was stopped",
            epoch: stopped)
        runtime?.resolveInvoke(id: id, resultJson: "null")
    }

    func handleKeychainSet(id: Int, payload: String) {
        let fields = Self.decodeObject(payload)
        guard let key = fields["key"] as? String,
            let value = fields["value"] as? String
        else {
            rejectInvalid(id: id, message: "keychainSet needs key + value")
            return
        }
        if KeychainStore.set(key: key, value: value) {
            runtime?.resolveInvoke(id: id, resultJson: "null")
        } else {
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(code: .internal, message: "keychain write failed"))
        }
    }

    func handleKeychainGet(id: Int, payload: String) {
        let fields = Self.decodeObject(payload)
        guard let key = fields["key"] as? String else {
            rejectInvalid(id: id, message: "keychainGet needs key")
            return
        }
        if let value = KeychainStore.get(key: key) {
            runtime?.resolveInvoke(id: id, resultJson: Self.jsonString(value))
        } else {
            runtime?.resolveInvoke(id: id, resultJson: "null")
        }
    }

    func handleKeychainDelete(id: Int, payload: String) {
        let fields = Self.decodeObject(payload)
        guard let key = fields["key"] as? String else {
            rejectInvalid(id: id, message: "keychainDelete needs key")
            return
        }
        KeychainStore.delete(key: key)
        runtime?.resolveInvoke(id: id, resultJson: "null")
    }

    func handleSpeak(id: Int, payload: String) {
        let fields = Self.decodeObject(payload)
        guard let text = fields["text"] as? String, !text.isEmpty else {
            rejectInvalid(id: id, message: "speak needs text")
            return
        }
        speechBridge.speak(
            text: text,
            rate: fields["rate"] as? Double,
            pitch: fields["pitch"] as? Double,
            language: fields["language"] as? String,
            volume: fields["volume"] as? Double
        )
        runtime?.resolveInvoke(id: id, resultJson: "null")
    }

    func handleStopSpeaking(id: Int) {
        speechBridge.stop()
        runtime?.resolveInvoke(id: id, resultJson: "null")
    }

    func handlePlayAudio(id: Int, payload: String) {
        let fields = Self.decodeObject(payload)
        guard let raw = fields["url"] as? String, let url = URL(string: raw) else {
            rejectInvalid(id: id, message: "playAudio needs a url")
            return
        }
        let gen = generation
        audioBridge.play(
            url: url,
            volume: fields["volume"] as? Double,
            loop: fields["loop"] as? Bool ?? false
        ) { [weak self] error in
            guard let self, gen == self.generation else { return }
            if let error {
                self.runtime?.rejectInvoke(
                    id: id,
                    errorJson: Self.errorJSON(code: .internal, message: error))
            } else {
                self.runtime?.resolveInvoke(id: id, resultJson: "null")
            }
        }
    }

    func handleStopAudio(id: Int) {
        audioBridge.stop()
        runtime?.resolveInvoke(id: id, resultJson: "null")
    }

    func handleGetProducts(id: Int, payload: String) {
        // `?? []` used to resolve an EMPTY product list for a typo'd key —
        // indistinguishable from "the App Store knows none of these ids", which
        // is the one outcome a paywall must not silently render. An explicitly
        // empty `productIds: []` is still a legitimate (if pointless) call.
        guard let raw = Self.decodeObject(payload)["productIds"] as? [Any] else {
            rejectInvalid(id: id, message: "getProducts needs productIds")
            return
        }
        let ids = raw.compactMap { $0 as? String }
        let gen = generation
        Task { [weak self] in
            let result = await StoreKitBridge.products(for: ids)
            await MainActor.run {
                guard let self, gen == self.generation else { return }
                self.settleStoreKit(id: id, result: result)
            }
        }
    }

    func handlePurchase(id: Int, payload: String) {
        guard let productId = Self.decodeObject(payload)["productId"] as? String else {
            rejectInvalid(id: id, message: "purchase needs productId")
            return
        }
        let gen = generation
        Task { [weak self] in
            let result = await StoreKitBridge.purchase(productId: productId)
            await MainActor.run {
                guard let self, gen == self.generation else { return }
                self.settleStoreKit(id: id, result: result)
            }
        }
    }

    func handleCurrentEntitlements(id: Int) {
        let gen = generation
        Task { [weak self] in
            let result = await StoreKitBridge.currentEntitlements()
            await MainActor.run {
                guard let self, gen == self.generation else { return }
                self.settleStoreKit(id: id, result: result)
            }
        }
    }

    func handleRestorePurchases(id: Int) {
        let gen = generation
        Task { [weak self] in
            let result = await StoreKitBridge.restore()
            await MainActor.run {
                guard let self, gen == self.generation else { return }
                self.settleStoreKit(id: id, result: result)
            }
        }
    }

    // MARK: - HealthKit reads (js/src/health.ts)
    //
    // Every handler follows the same two-step shape: validate the request in
    // Linux-tested ReactWatchSupport (a bad one rejects INVALID_REQUEST naming
    // the rule that failed — the statistic/type pairing Apple enforces by
    // THROWING is the reason this is code and not documentation), then run the
    // descriptor query and settle generation-guarded (CX-008), so a query
    // landing after a dev reload is dropped instead of settling the fresh
    // runtime's reused id space.

    /// Refuses every health read on a watch with no HealthKit, so the caller
    /// gets `UNAVAILABLE` instead of an empty result it would have to read as
    /// "no data". `requestHealthAuthorization` reports "unavailable" in-band
    /// instead — it is the method whose whole job is answering that question.
    private func healthAvailable(id: Int) -> Bool {
        guard HealthQueryBridge.isAvailable else {
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(
                    code: .unavailable,
                    message: "HealthKit is not available on this device"))
            return false
        }
        return true
    }

    private func handleRequestHealthAuthorization(id: Int, payload: String) {
        switch HealthAuthorizationPlan.decode(json: payload) {
        case .failure(let error):
            rejectInvalid(id: id, message: error.message)
        case .success(let plan):
            let gen = generation
            Task { [weak self] in
                guard let bridge = self?.health else { return }
                let status = await bridge.requestAuthorization(plan)
                guard let self, gen == self.generation else { return }
                self.runtime?.resolveInvoke(
                    id: id, resultJson: Self.jsonString(status))
            }
        }
    }

    private func handleQueryHealthStatistics(id: Int, payload: String) {
        switch HealthStatisticsPlan.decode(json: payload) {
        case .failure(let error):
            rejectInvalid(id: id, message: error.message)
        case .success(let plan):
            guard healthAvailable(id: id) else { return }
            let gen = generation
            Task { [weak self] in
                guard let bridge = self?.health else { return }
                let outcome = await bridge.statistics(plan)
                self?.settleHealth(id: id, generation: gen, outcome)
            }
        }
    }

    /// The bucketed sibling. Same request shape and the same validation, plus
    /// the one rule only a collection has — a ceiling on the number of buckets
    /// — which is why it decodes through `decodeDaily` rather than `decode`.
    private func handleQueryHealthDailyStatistics(id: Int, payload: String) {
        switch HealthStatisticsPlan.decodeDaily(json: payload) {
        case .failure(let error):
            rejectInvalid(id: id, message: error.message)
        case .success(let plan):
            guard healthAvailable(id: id) else { return }
            let gen = generation
            Task { [weak self] in
                guard let bridge = self?.health else { return }
                let outcome = await bridge.dailyStatistics(plan)
                self?.settleHealth(id: id, generation: gen, outcome)
            }
        }
    }

    private func handleQueryHealthSamples(id: Int, payload: String) {
        switch HealthSamplesPlan.decode(json: payload) {
        case .failure(let error):
            rejectInvalid(id: id, message: error.message)
        case .success(let plan):
            guard healthAvailable(id: id) else { return }
            let gen = generation
            Task { [weak self] in
                guard let bridge = self?.health else { return }
                let outcome = await bridge.samples(plan)
                self?.settleHealth(id: id, generation: gen, outcome)
            }
        }
    }

    private func handleQuerySleepSamples(id: Int, payload: String) {
        switch SleepSamplesPlan.decode(json: payload) {
        case .failure(let error):
            rejectInvalid(id: id, message: error.message)
        case .success(let plan):
            guard healthAvailable(id: id) else { return }
            let gen = generation
            Task { [weak self] in
                guard let bridge = self?.health else { return }
                let outcome = await bridge.sleepSamples(plan)
                self?.settleHealth(id: id, generation: gen, outcome)
            }
        }
    }

    /// The saved-workout read. Sits with its health siblings rather than with
    /// the workout-control handlers on purpose: it is gated by `health`, the
    /// history-disclosure feature, not by `workouts`, which authorizes
    /// RECORDING one.
    private func handleQueryWorkoutHistory(id: Int, payload: String) {
        switch WorkoutHistoryPlan.decode(json: payload) {
        case .failure(let error):
            rejectInvalid(id: id, message: error.message)
        case .success(let plan):
            guard healthAvailable(id: id) else { return }
            let gen = generation
            Task { [weak self] in
                guard let bridge = self?.health else { return }
                let outcome = await bridge.workoutHistory(plan)
                self?.settleHealth(id: id, generation: gen, outcome)
            }
        }
    }

    private func settleHealth(
        id: Int, generation gen: Int, _ outcome: HealthQueryBridge.Outcome
    ) {
        guard gen == generation else { return }
        switch outcome {
        case .ok(let json):
            runtime?.resolveInvoke(id: id, resultJson: json)
        case .error(let message):
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(code: .internal, message: message))
        }
    }

    // MARK: - EventKit reads (js/src/calendar.ts)

    /// Runs the EventKit TCC sheet for one entity and resolves the resulting
    /// status as a bare string — the `requestNotificationPermission` /
    /// `requestHealthAuthorization` precedent, and the reason the schema
    /// declares no `response` shape for it.
    ///
    /// User-mediated: the sheet blocks on a person, so JS raises the watchdog
    /// to `USER_MEDIATED_INVOKE_TIMEOUT_MS` for this call.
    private func handleRequestCalendarAccess(id: Int, payload: String) {
        switch CalendarAccessPlan.decode(json: payload) {
        case .failure(let error):
            rejectInvalid(id: id, message: error.message)
        case .success(let plan):
            let gen = generation
            Task { [weak self] in
                guard let bridge = self?.calendar else { return }
                let status = await bridge.requestAccess(plan)
                guard let self, gen == self.generation else { return }
                self.runtime?.resolveInvoke(
                    id: id, resultJson: Self.jsonString(status.rawValue))
            }
        }
    }

    private func handleGetCalendarEvents(id: Int, payload: String) {
        switch CalendarEventsPlan.decode(json: payload) {
        case .failure(let error):
            rejectInvalid(id: id, message: error.message)
        case .success(let plan):
            let gen = generation
            Task { [weak self] in
                guard let bridge = self?.calendar else { return }
                let outcome = await bridge.events(plan)
                self?.settleCalendar(id: id, generation: gen, outcome)
            }
        }
    }

    private func handleGetReminders(id: Int, payload: String) {
        switch RemindersPlan.decode(json: payload) {
        case .failure(let error):
            rejectInvalid(id: id, message: error.message)
        case .success(let plan):
            let gen = generation
            Task { [weak self] in
                guard let bridge = self?.calendar else { return }
                let outcome = await bridge.reminders(plan)
                self?.settleCalendar(id: id, generation: gen, outcome)
            }
        }
    }

    /// The `settleHealth` shape plus the arm EventKit genuinely has: a refusal
    /// the USER can act on rejects PERMISSION_DENIED, not INTERNAL — the same
    /// split `OneShotLocation` makes between `.denied` and `.unavailable`, and
    /// the distinction `queryPedometer` had to be fixed to make. An empty
    /// window still resolves `[]` (the `handleSearchPOI` rule): "nothing on
    /// your calendar" is a real answer, "you said no" is not.
    private func settleCalendar(
        id: Int, generation gen: Int, _ outcome: CalendarBridge.Outcome
    ) {
        guard gen == generation else { return }
        switch outcome {
        case .ok(let json):
            runtime?.resolveInvoke(id: id, resultJson: json)
        case .denied(let message):
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(code: .permissionDenied, message: message))
        case .error(let message):
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(code: .internal, message: message))
        }
    }

    // MARK: - Workout control (js/src/workout.ts)

    /// Starts an explicit workout and PARKS the invoke on the session's real
    /// lifecycle, so `await startWorkout()` means "running".
    ///
    /// The refusals below are returned synchronously by the owner because each
    /// produces no delegate callback at all — an already-running workout, an
    /// unknown activity name, a watch with no HealthKit. Resolving them later
    /// would leave the promise hanging to its 30 s watchdog (the
    /// `ExtendedRuntimeBridge.start() -> Bool` lesson).
    private func handleStartWorkout(id: Int, payload: String) {
        switch WorkoutStartPlan.decode(json: payload) {
        case .failure(let error):
            rejectInvalid(id: id, message: error.message)
        case .success(let plan):
            // The ONE cross-feature check. ARCH-07 gates one feature per method
            // by design, but a route is location data: it needs `location` as
            // well as `workouts`, and a second method whose only job is to flip
            // a bool would be worse than this in-body check.
            if plan.collectRoute, !effectiveFeatures.contains("location") {
                runtime?.rejectInvoke(
                    id: id,
                    errorJson: Self.errorJSON(
                        code: .policyDenied,
                        message: "startWorkout({ collectRoute: true }) also "
                            + "requires the 'location' feature, which this app's "
                            + "host policy doesn't authorize"))
                return
            }
            if let refusal = workout.startWorkout(plan) {
                runtime?.rejectInvoke(
                    id: id,
                    errorJson: Self.errorJSON(
                        code: .unavailable, message: refusal))
                return
            }
            if plan.collectRoute { sensors.startRouteTracking() }
            pendingWorkoutStarts.append(
                (id: id, generation: generation, epoch: workout.epoch))
        }
    }

    /// Settles the parked `startWorkout`s belonging to the session this callback
    /// came from. `running` resolves; `ended` rejects UNAVAILABLE with the
    /// system's reason — which is what a consumer whose session was killed by
    /// another app's workout actually hits, and what used to look like success.
    /// Stale generations drop (CX-008); `tearDownForReload` detaches the
    /// delegate, so a reload produces no callback here at all.
    private func settleWorkoutStarts(
        state: String, reason: String?, epoch: Int
    ) {
        guard state == "running" || state == "ended" else { return }
        let pending = pendingWorkoutStarts
        pendingWorkoutStarts = pending.filter {
            $0.generation == generation && $0.epoch != epoch
        }
        for entry in pending
        where entry.generation == generation && entry.epoch == epoch {
            if state == "running" {
                runtime?.resolveInvoke(id: entry.id, resultJson: "null")
            } else {
                runtime?.rejectInvoke(
                    id: entry.id,
                    errorJson: Self.errorJSON(
                        code: .unavailable,
                        message: "the workout session ended before it started: "
                            + (reason ?? "unknown reason")))
            }
        }
    }

    private func handlePauseWorkout(id: Int) {
        settleWorkoutCommand(
            id: id, ok: workout.pauseWorkout(),
            message: "no running workout to pause")
    }

    private func handleResumeWorkout(id: Int) {
        settleWorkoutCommand(
            id: id, ok: workout.resumeWorkout(),
            message: "no paused workout to resume")
    }

    /// Ends + (by default) SAVES the workout, resolving with the same
    /// `WorkoutState` snapshot `getWorkoutState` reports — so the caller gets
    /// the saved workout's id, duration, energy and distance without a second
    /// round trip. `discard: true` throws it away instead; Apple's HIG requires
    /// an app to either save automatically or offer an explicit save/discard
    /// choice, and defaulting to save is the half that can't lose data.
    private func handleEndWorkout(id: Int, payload: String) {
        let discard = Self.decodeObject(payload)["discard"] as? Bool ?? false
        let gen = generation
        let ended = workout.endWorkout(discard: discard) { [weak self] snapshot in
            guard let self, gen == self.generation else { return }
            self.sensors.stopRouteTracking()
            self.runtime?.resolveInvoke(
                id: id, resultJson: Self.jsonObject(snapshot))
        }
        if !ended {
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(
                    code: .unavailable, message: "no workout is running"))
        }
    }

    /// The live workout plus the LAST ended one. The second half is how a
    /// workout ended by a dev reload / OTA apply reaches the runtime that never
    /// started it (ARCH-08 deterministic teardown): the owner saves it and
    /// parks the summary, and this is where the fresh runtime reads it.
    private func handleGetWorkoutState(id: Int) {
        runtime?.resolveInvoke(
            id: id, resultJson: Self.jsonObject(workout.stateSnapshot()))
    }

    /// pause/resume are synchronous state changes on a session that must exist;
    /// "no workout is running" is a refusal, not a silent success (rule 12).
    private func settleWorkoutCommand(id: Int, ok: Bool, message: String) {
        if ok {
            runtime?.resolveInvoke(id: id, resultJson: "null")
        } else {
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(code: .unavailable, message: message))
        }
    }

    // MARK: - WorkoutKit plans (js/src/workoutPlans.ts)
    //
    // Same two-step shape as the HealthKit reads: validate in Linux-tested
    // ReactWatchSupport (`WorkoutPlanSpec`), then hand a VALIDATED spec to the
    // watchOS-only bridge and settle generation-guarded (CX-008). The bridge is
    // stateless, so nothing here parks, claims or tears down — every op is one
    // `WorkoutScheduler.shared` round trip.
    //
    // `Calendar.current` is read HERE and passed in rather than inside the
    // bridge, so the atMs <-> DateComponents conversion stays a pure function
    // of its arguments and `swift test` can prove the round trip on Linux.

    /// Runs the WorkoutKit permission sheet. Unlike HealthKit reads this
    /// resolves a REAL verdict; the bridge reads the standing state first so a
    /// second call cannot re-prompt. User-mediated, so JS raises the watchdog
    /// to `USER_MEDIATED_INVOKE_TIMEOUT_MS` for it.
    private func handleRequestWorkoutPlanAuthorization(id: Int) {
        let gen = generation
        Task { [weak self] in
            guard let bridge = self?.workoutPlans else { return }
            let outcome = await bridge.requestAuthorization()
            self?.settleWorkoutPlan(id: id, generation: gen, outcome)
        }
    }

    private func handleScheduleWorkoutPlan(id: Int, payload: String) {
        switch WorkoutPlanScheduleSpec.decode(json: payload) {
        case .failure(let error):
            rejectInvalid(id: id, message: error.message)
        case .success(let spec):
            let gen = generation
            Task { [weak self] in
                guard let bridge = self?.workoutPlans else { return }
                let outcome = await bridge.schedule(spec, calendar: .current)
                self?.settleWorkoutPlan(id: id, generation: gen, outcome)
            }
        }
    }

    private func handleListScheduledWorkoutPlans(id: Int) {
        let gen = generation
        Task { [weak self] in
            guard let bridge = self?.workoutPlans else { return }
            let outcome = await bridge.scheduledSummaries(calendar: .current)
            self?.settleWorkoutPlan(id: id, generation: gen, outcome)
        }
    }

    private func handleRemoveScheduledWorkoutPlan(id: Int, payload: String) {
        switch ScheduledWorkoutRefSpec.decode(json: payload) {
        case .failure(let error):
            rejectInvalid(id: id, message: error.message)
        case .success(let ref):
            let gen = generation
            Task { [weak self] in
                guard let bridge = self?.workoutPlans else { return }
                let outcome = await bridge.remove(ref, calendar: .current)
                self?.settleWorkoutPlan(id: id, generation: gen, outcome)
            }
        }
    }

    private func handleRemoveAllScheduledWorkoutPlans(id: Int) {
        let gen = generation
        Task { [weak self] in
            guard let bridge = self?.workoutPlans else { return }
            let outcome = await bridge.removeAll()
            self?.settleWorkoutPlan(id: id, generation: gen, outcome)
        }
    }

    /// Hands a plan to the Workout app, which on watchOS LAUNCHES it — so this
    /// backgrounds us while the invoke is in flight. No `isSupported` gate:
    /// that flag answers whether the device supports SCHEDULED workouts, a
    /// different question from whether a plan can be opened now.
    private func handleOpenWorkoutPlanInWorkoutApp(id: Int, payload: String) {
        switch WorkoutPlanSpec.decodeOpen(json: payload) {
        case .failure(let error):
            rejectInvalid(id: id, message: error.message)
        case .success(let spec):
            let gen = generation
            Task { [weak self] in
                guard let bridge = self?.workoutPlans else { return }
                let outcome = await bridge.open(spec)
                self?.settleWorkoutPlan(id: id, generation: gen, outcome)
            }
        }
    }

    /// The `settleHealth` shape plus the two arms WorkoutKit genuinely has: a
    /// plan Apple's own legality checks refused is INVALID_REQUEST (a code
    /// change), and a device or scheduler that said no is UNAVAILABLE (not).
    /// The `isSupported` refusal is the bridge's — one gate, in the file that
    /// knows the answer, rather than a second copy here.
    private func settleWorkoutPlan(
        id: Int, generation gen: Int, _ outcome: WorkoutPlanBridge.Outcome
    ) {
        guard gen == generation else { return }
        switch outcome {
        case .ok(let json):
            runtime?.resolveInvoke(id: id, resultJson: json)
        case .invalid(let message):
            rejectInvalid(id: id, message: message)
        case .unavailable(let message):
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(code: .unavailable, message: message))
        }
    }

    /// CMPedometer's historical query (~7 days of on-device step history).
    ///
    /// Same `sensors` feature as the live motion streams, deliberately:
    /// CMPedometer is CoreMotion — the same framework, the same
    /// NSMotionUsageDescription, and the same single OS consent toggle
    /// ("Motion & Fitness"). A user cannot grant one and deny the other, so a
    /// separate feature id would map to no independently-grantable consent.
    ///
    /// The `false` return is the documented-crash guard: Apple states calling
    /// CMPedometer without NSMotionUsageDescription CRASHES the app, so the
    /// bridge checks the key first and this is where that refusal gets an
    /// actionable message instead of a silent no-op.
    private func handleQueryPedometer(id: Int, payload: String) {
        switch PedometerQueryPlan.decode(json: payload) {
        case .failure(let error):
            rejectInvalid(id: id, message: error.message)
        case .success(let plan):
            let gen = generation
            let started = sensors.pedometer.query(plan) { [weak self] outcome in
                guard let self, gen == self.generation else { return }
                switch outcome {
                case .success(let reading):
                    self.runtime?.resolveInvoke(
                        id: id, resultJson: Self.jsonObject(reading))
                // A denied "Motion & Fitness" used to reject INTERNAL with the
                // no-data message — the third instance of the mistake
                // InvokeErrorJSON's enum was introduced to stop (after
                // `AUDIO_FAILED` and `LOCATION_UNAVAILABLE`): the code compiled,
                // but it told the caller "you didn't walk" for the one state a
                // caller can act on. PERMISSION_DENIED is what `getCurrentLocation`
                // already reports for the same class of refusal.
                case .failure(.denied):
                    self.runtime?.rejectInvoke(
                        id: id,
                        errorJson: Self.errorJSON(
                            code: .permissionDenied,
                            message: "Motion & Fitness permission denied — "
                                + "re-enable it for this app in Settings"))
                case .failure(.unavailable):
                    self.runtime?.rejectInvoke(
                        id: id,
                        errorJson: Self.errorJSON(
                            code: .internal,
                            message: "CoreMotion returned no pedometer data"))
                }
            }
            if !started {
                runtime?.rejectInvoke(
                    id: id,
                    errorJson: Self.errorJSON(
                        code: .unavailable,
                        message: PedometerBridge.usageDescriptionMissing
                            ? PedometerBridge.missingUsageDescriptionMessage
                            : "step counting is not available on this device"))
            }
        }
    }

    private func settleStoreKit(id: Int, result: StoreKitBridge.Result) {
        switch result {
        case .ok(let json):
            runtime?.resolveInvoke(id: id, resultJson: json)
        case .error(let message):
            runtime?.rejectInvoke(
                id: id,
                errorJson: Self.errorJSON(code: .internal, message: message))
        }
    }

    static func decodeObject(_ json: String) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: Data(json.utf8)))
            as? [String: Any] ?? [:]
    }

    /// Shared INVALID_REQUEST rejection for the capability handlers.
    private func rejectInvalid(id: Int, message: String) {
        runtime?.rejectInvoke(
            id: id,
            errorJson: Self.errorJSON(code: .invalidRequest, message: message))
    }
}

#endif
