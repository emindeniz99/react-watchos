import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostMethods } from "../codegen/schema";
import { HOST_FEATURES } from "../src/generated/wire";

/**
 * Negative checks for the guards the PLATFORM-DATA package adds — the cases
 * each one exists to REFUSE, rather than the happy path the feature tests
 * already cover.
 *
 * Most of them live in `#if os(watchOS)` code no Linux job can compile, so they
 * are scanned textually, the way `codegen.test.ts` scans the invoke router,
 * `invoke-producer-keys.test.ts` scans the response producers and
 * `health-package-guards.test.ts` scans the workout owner. A textual scan is
 * weaker than a compile and stronger than the nothing these rules had — and
 * three of the rules below (the receive ordering, the two luminance
 * mechanisms, the deprecated-EventKit ban) are silent-data-loss or
 * silent-no-op bugs whose symptom no other gate can see.
 */

const swiftRoot = join(__dirname, "../swift/Sources");
const read = (rel: string) => readFileSync(join(swiftRoot, rel), "utf8");
const readSrc = (rel: string) =>
  readFileSync(join(__dirname, "../src", rel), "utf8");
/** Comment lines dropped. Every "this symbol must NOT appear" check below runs
 *  through here, because the comment that explains WHY a symbol is banned
 *  names it — and would otherwise satisfy the ban it documents. */
const code = (src: string) =>
  src
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

const CONNECTIVITY = "ReactWatchHost/PhoneConnectivity.swift";
const HOST = "ReactWatchHost/ReactWatchHost.swift";
const CALENDAR = "ReactWatchHost/CalendarBridge.swift";

/** From `decl` to the end of the file — enough to index-compare statements
 *  inside one function against each other when the next marker is given. */
function slice(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  expect(start, `no \`${from}\` in the source`).toBeGreaterThan(-1);
  const end = src.indexOf(to, start + from.length);
  expect(end, `no \`${to}\` after \`${from}\``).toBeGreaterThan(-1);
  return src.slice(start, end);
}

describe("an inbound file is moved before anything else can happen", () => {
  it("adopts the file BEFORE the main-queue hop, and prunes after", () => {
    // THE HAZARD, and it is silent: Apple states the system "places downloaded
    // files inside a temporary directory" and "deletes the file after this
    // method returns", and that you must move it SYNCHRONOUSLY. Every other
    // delegate method in this file hops to main first (`deliver`), so writing
    // this one to the same shape is the natural mistake — and it would lose
    // every received file with no error anywhere. Pruning after the move
    // matters for the same reason: a prune that threw before the adopt would
    // take the delivery down with it.
    const body = slice(
      read(CONNECTIVITY),
      "func session(_: WCSession, didReceive file: WCSessionFile) {",
      "/// Terminal state of an OUTBOUND transfer",
    );
    const adopt = body.indexOf("inbox.adopt(");
    const prune = body.indexOf("inbox.prune(");
    const hop = body.indexOf("deliver(");
    expect(adopt).toBeGreaterThan(-1);
    expect(prune).toBeGreaterThan(adopt);
    expect(hop).toBeGreaterThan(prune);
  });

  it("never prunes a file whose event is still queued on main", () => {
    // The other half of the same hazard, and it is silent in BOTH directions.
    // `deliver` only SCHEDULES onto main while this delegate runs on
    // WatchConnectivity's background thread, so a backlog (WCSession's file
    // queue survives suspension) can outrun main by more than `maxFiles` and
    // prune a path JS has not been handed yet. Nothing reports it, and
    // `FileInbox.resolve` still accepts the dead path, so `deleteReceivedFile`
    // on it returns success. The protected set is the coupling: taken BEFORE
    // the prune, released only after the handler has actually run.
    const body = slice(
      read(CONNECTIVITY),
      "func session(_: WCSession, didReceive file: WCSessionFile) {",
      "/// Terminal state of an OUTBOUND transfer",
    );
    const insert = body.indexOf("pendingReceipts.insert(landed)");
    const prune = body.indexOf("inbox.prune(protecting: protected)");
    const release = body.indexOf("pendingReceipts.release(landed)");
    expect(insert).toBeGreaterThan(-1);
    expect(prune).toBeGreaterThan(insert);
    // The release must be the delivery's COMPLETION, not another statement on
    // this background thread — releasing here would restore the whole race.
    expect(release).toBeGreaterThan(prune);
    expect(body).toContain("then: { [pendingReceipts] in");
    // And `deliver` has to actually run it after the handler, on main.
    const deliver = slice(
      read(CONNECTIVITY),
      "then completion: (@Sendable () -> Void)? = nil",
      "\n    }\n",
    );
    expect(deliver.indexOf("completion?()")).toBeGreaterThan(
      deliver.indexOf("handler?(event, payload)"),
    );
  });

  it("reduces every inbound plist to JSON at the ONE bridge boundary", () => {
    // Everything WatchConnectivity hands this class is a PROPERTY LIST, not
    // JSON. Apple's contract for sendMessage / updateApplicationContext /
    // transferUserInfo / transferFile is "the values of the dictionary must all
    // be property list object types", and each delegate passes the sender's
    // dictionary through verbatim — so a Date or Data leaf is the API used
    // exactly as documented, by an iPhone app this library cannot constrain.
    // One such leaf makes the ENTIRE payload unserializable: `pushNativeEvent`
    // hands JS `undefined` and the whole event is lost, silently. For the file
    // channel that also orphans a file already on disk (no enumeration op,
    // `deleteReceivedFile("")` cannot address it).
    //
    // The rule lives in `deliver` because that is the ONE place a payload
    // leaves this class for the bridge. Per-call-site sanitizing is what failed
    // the first time: the file channel got it and its three siblings did not.
    const src = read(CONNECTIVITY);
    const deliver = slice(
      src,
      "then completion: (@Sendable () -> Void)? = nil",
      "\n    }\n",
    );
    expect(code(deliver)).toContain(
      "let payload = RemotePushWire.sanitize(message)",
    );
    // …and it is only the one boundary while `onPush` is called nowhere else:
    // one mention declares it, one reads it inside `deliver`. A third would be
    // a payload reaching JS around the rule.
    expect(code(src).match(/onPush/g)).toHaveLength(2);
    // The three plist channels must therefore route through `deliver` — a
    // delegate that pushed some other way would bypass it.
    for (const [decl, event] of [
      [
        "_: WCSession, didReceiveMessage message: [String: Any]",
        '"watchConnectivity"',
      ],
      [
        "_: WCSession, didReceiveApplicationContext context: [String: Any]",
        '"watchConnectivity.applicationContext"',
      ],
      [
        "_: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]",
        '"watchConnectivity.userInfo"',
      ],
    ]) {
      expect(code(slice(src, decl as string, "\n    }\n"))).toContain(
        `deliver(${event}`,
      );
    }
  });

  it("reduces the phone's sendMessage REPLY too — it settles an invoke", () => {
    // The one inbound plist that does not travel through `deliver`: the reply
    // resolves the `sendToPhone` invoke instead. Same sender, same contract,
    // same defect — and worse on Darwin, where JSONSerialization's documented
    // "Invalid type in JSON write" is an ObjC exception `try?` cannot catch.
    const body = slice(
      read(CONNECTIVITY),
      "replyHandler: { reply in",
      "errorHandler:",
    );
    expect(code(body)).toContain(
      "withJSONObject: RemotePushWire.sanitize(reply)",
    );
  });

  it("reports a receive it could not land instead of dropping it silently", () => {
    // There is no invoke to reject — nobody asked for this file — so a failure
    // has exactly one place to go (rule 12). Both failure paths must reach it.
    const body = slice(
      read(CONNECTIVITY),
      "func session(_: WCSession, didReceive file: WCSessionFile) {",
      "/// Terminal state of an OUTBOUND transfer",
    );
    expect(body).toContain(
      'report(\n                "connectivity.inboxUnavailable"',
    );
    expect(body).toContain(
      'report(\n                "connectivity.receiveFailed"',
    );
    expect(read(HOST)).toContain(
      "connectivity.onError = { [weak self] code, details in",
    );
  });

  it("readReceivedFile is gated on `connectivity`, not `network`", () => {
    // THE reason the op exists at all, next to the size ceiling. `fetch` is
    // gated on `network` while every file op is `connectivity`, so a bundle
    // policy-limited to `connectivity` used to be handed inbox paths it had no
    // permitted way to open. Moving the read under `network` would restore
    // exactly that hole, silently — the files still arrive.
    const method = hostMethods.find((m) => m.name === "readReceivedFile");
    expect(method?.feature).toBe("connectivity");
    // WCSession does not exist for a widget extension, and neither does its
    // inbox: the read must not become a widget's way into the container.
    expect(method?.targets).toEqual(["watch"]);
    expect(HOST_FEATURES.widget).not.toContain("connectivity");
  });

  it("readReceivedFile decides nothing in the watchOS adapter", () => {
    // The containment check, the chunk ceiling and the range clamp are the
    // whole security and correctness surface of this op, and all three live in
    // `FileInbox` (ReactWatchSupport) where `swift test` reaches them on Linux.
    // A `resolve`/`FileHandle`/`base64` appearing in the watchOS file would be
    // a second, uncompiled copy of a rule that must not drift.
    const body = code(
      slice(
        read(CONNECTIVITY),
        "func readReceivedFile(_ json: String) -> Result<[String: Any], SendError> {",
        "private static func activationName",
      ),
    );
    expect(body).toContain("ReceivedFileReadPlan.decode(json: json)");
    expect(body).toContain("inbox.read(plan)");
    for (const decided of [
      "resolve(",
      "FileHandle",
      "base64",
      "maxReadBytes",
    ]) {
      expect(
        body,
        `${decided} is decided in the watchOS adapter`,
      ).not.toContain(decided);
    }
  });

  it("deleteReceivedFile resolves the path through the inbox's containment check", () => {
    // The whole reason the op takes a path at all. Without `resolve`, a bundle
    // could hand back `…/ReactWatchInbox/../../Library/Preferences/…` and have
    // the host delete it. `FileInbox.resolve` standardizes `..` away BEFORE the
    // prefix compare (proven on Linux in FileInboxTests).
    const body = slice(
      read(CONNECTIVITY),
      "func deleteReceivedFile(_ json: String) -> SendError? {",
      "private static func activationName",
    );
    const resolve = body.indexOf("inbox.resolve(path: path)");
    const remove = body.indexOf("removeItem");
    expect(resolve).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(resolve);
  });
});

describe("an outbound transfer resolves when QUEUED, not when delivered", () => {
  it("handleTransferFile settles synchronously and parks nothing", () => {
    // The `extendedRuntime` / `remotePush` parking precedent does NOT apply:
    // Apple documents transferFile as throttled, surviving suspension, and
    // able to complete in a LATER LAUNCH — so a parked invoke would blow the
    // 30 s watchdog every time and the 5 min user-mediated bound would not fix
    // "next launch" either. A `pending…` list appearing here is that mistake.
    const body = slice(
      read(HOST),
      "private func handleTransferFile(id: Int, payload: String) {",
      "private func handleOutstandingFileTransfers",
    );
    expect(body).toContain("resolveInvoke");
    expect(body).not.toMatch(/pending\w*\.append/);
    expect(read(HOST)).not.toContain("pendingFileTransfers");
  });

  it("the soft size cap WARNS and still transfers", () => {
    // ARCH-13 posture, and here it is load-bearing: the 1 MB number is OURS
    // and unmeasured (Apple publishes no cap for transferFile), so rejecting
    // on it would refuse transfers WatchConnectivity would have accepted.
    // WCError is the authority; the budget is a tripwire.
    const success = slice(
      read(HOST),
      "case .success(let queued):",
      "private func handleOutstandingFileTransfers",
    );
    expect(success).toContain("budgets.check(");
    expect(success).toContain("transferFileBytes: queued.bytes");
    expect(success).toContain("resolveInvoke");
    expect(success).not.toContain("rejectInvoke");
  });

  it("refuses to call transferFile on a session that is not activated", () => {
    // Apple: "Calling this method for an inactive or deactivated session is a
    // programmer error." A JS call must not be able to trip one.
    const body = slice(
      read(CONNECTIVITY),
      "func transferFile(_ json: String) -> Result<QueuedFileTransfer, SendError> {",
      "/// Cancels a transfer this launch queued.",
    );
    expect(body).toContain(
      "guard session.activationState == .activated else {",
    );
    // And the file must exist here, not fail invisibly on the delegate much
    // later, where the caller has no invoke left to hear about it.
    expect(body).toContain("no readable file at");
  });

  it("the transfer id space is NEVER reset per JS generation", () => {
    // Deliberately the opposite of the BLE precedent, and the contrast is the
    // point: BLE ids come from the RUNTIME's id space (restarts at 1 per boot),
    // so a late delegate could settle a different promise that reused an id.
    // These ids come from an object that outlives every generation, so reuse is
    // impossible — adding a reset hook would REINTRODUCE the hazard rather than
    // guard against it.
    expect(code(read(CONNECTIVITY))).not.toContain("resetPendingForReload");
    const teardown = slice(
      read(HOST),
      "private func tearDownGeneration() {",
      "private func installFreshRuntime()",
    ).replace(/^\s*\/\/.*$/gm, "");
    expect(teardown).toContain("bluetooth.resetPendingForReload()");
    expect(teardown).not.toContain("connectivity.");
  });

  it("cancelling a minted-but-settled id is a no-op, not a false rejection", () => {
    // `didFinish` is the only writer that REMOVES from `transfersById`, so a
    // transfer that already completed leaves a MINTED id with no live entry.
    // Rejecting that asserts something false — this launch did queue it — and
    // contradicts the API being wrapped: Apple, `WCSessionFileTransfer.cancel()`
    // — "If the file has already been transferred, calling this method has no
    // effect." The completion races the cancel by nature (it arrives on the
    // push channel, not on this invoke), so every Cancel button hits this.
    const body = slice(
      read(CONNECTIVITY),
      "func cancelFileTransfer(_ json: String) -> SendError? {",
      "/// Every transfer WCSession still has queued.",
    );
    // The predicate must be read under the SAME lock acquisition as the map,
    // or the two observations can tear against a concurrent `didFinish`.
    const lock = body.indexOf("transferLock.lock()");
    const minted = body.indexOf("let minted = id > 0 && id < nextTransferId");
    const unlock = body.indexOf("transferLock.unlock()");
    expect(minted).toBeGreaterThan(lock);
    expect(unlock).toBeGreaterThan(minted);
    expect(code(body)).toContain("guard !minted else { return nil }");
    // An id this launch never minted still rejects — that is the case the
    // rejection was written for and it must survive.
    expect(body).toContain("was queued by this launch");
  });

  it("keeps the file ops under `connectivity` rather than minting a feature", () => {
    // Same KIND of privilege as transferUserInfo (move app data to the paired
    // phone), just a larger payload — unlike the push-vs-notifications split,
    // whose justification was a grant that genuinely differed.
    const fileOps = [
      "transferFile",
      "cancelFileTransfer",
      "outstandingFileTransfers",
      "getConnectivityState",
      "deleteReceivedFile",
    ];
    for (const name of fileOps) {
      const method = hostMethods.find((m) => m.name === name);
      expect(method?.feature, `${name} minted its own feature`).toBe(
        "connectivity",
      );
      // WCSession does not exist for a widget extension.
      expect(method?.targets).toEqual(["watch"]);
    }
  });
});

describe("EventKit asks for the access it actually needs", () => {
  it("uses the modern full-access APIs and never the deprecated ones", () => {
    // Apple: "Your app can't request read-only access… To read events or
    // reminders from the event store, your app needs full access." So a
    // read-only API must still call requestFullAccess*. `requestAccess(to:)`
    // is deprecated AT our floor, and `requestWriteOnlyAccessToEvents` cannot
    // read at all — calling either would produce an API that prompts and then
    // returns nothing.
    const src = code(read(CALENDAR));
    expect(src).toContain("requestFullAccessToEvents");
    expect(src).toContain("requestFullAccessToReminders");
    expect(src).not.toContain("requestAccess(to:");
    expect(src).not.toContain("requestWriteOnlyAccess");
  });

  it("treats ONLY fullAccess as readable, and keeps writeOnly its own answer", () => {
    const src = code(read(CALENDAR));
    expect(src).toContain("case .fullAccess: .granted");
    expect(src).toContain("case .writeOnly: .writeOnly");
    // `.authorized` is the pre-17 spelling of the SAME raw value as
    // `.fullAccess` — naming both would be a duplicate case, not coverage.
    expect(src).not.toContain("case .authorized");
    // An unknown status degrades to `unavailable`, never to a readable state.
    expect(src).toContain("@unknown default: .unavailable");
  });

  it("rejects a refusal as PERMISSION_DENIED, not INTERNAL", () => {
    // The distinction `queryPedometer` had to be fixed to make: INTERNAL tells
    // a caller "something broke"; PERMISSION_DENIED tells them (and the user)
    // that Settings is the fix. An empty window still resolves `[]`.
    const body = slice(
      read(HOST),
      "private func settleCalendar(",
      "// MARK: - Workout control",
    );
    expect(body).toContain("case .denied(let message):");
    expect(body).toContain("code: .permissionDenied");
  });

  it("runs the synchronous EventKit query off the main thread", () => {
    // Apple documents `events(matching:)` as synchronous and potentially slow.
    // On main it would stall the render loop for the length of the query.
    const src = read(CALENDAR);
    expect(src).toContain('DispatchQueue(label: "react.watch.calendar")');
    const body = slice(
      src,
      "func events(_ plan: CalendarEventsPlan) async -> Outcome {",
      "/// Incomplete reminders due before",
    );
    const queue = body.indexOf("Self.queue.async {");
    const query = body.indexOf("store.events(matching: predicate)");
    expect(queue).toBeGreaterThan(-1);
    expect(query).toBeGreaterThan(queue);
  });

  it("holds ONE long-lived EKEventStore", () => {
    // Apple, EKEventStore: "Releasing an event store instance before other
    // EventKit objects may result in an error." A per-call store would be
    // released while the events it vended were still being read.
    const src = read(CALENDAR);
    expect(src).toContain("private let store = EKEventStore()");
    expect(src.match(/EKEventStore\(\)/g)).toHaveLength(1);
    expect(read(HOST)).toContain("private let calendar = CalendarBridge()");
  });

  it("raises the invoke watchdog for the user-mediated permission sheet", () => {
    // The single most likely bug in this item: the sheet blocks on a person,
    // which routinely outlasts the 30 s default — so a GRANTED permission
    // would surface as a spurious rejection.
    const src = readSrc("calendar.ts");
    const call = slice(src, "export function requestCalendarAccess(", "\n}\n");
    expect(call).toContain("timeoutMs: USER_MEDIATED_INVOKE_TIMEOUT_MS");
    // The two reads are NOT user-mediated and must keep the default bound.
    expect(
      slice(src, "export function getCalendarEvents(", "\n}\n"),
    ).not.toContain("timeoutMs");
  });

  it("keeps `calendar` a watch-only feature", () => {
    expect(
      hostMethods.filter(
        (m) => m.feature === "calendar" && m.targets.includes("widget"),
      ),
    ).toEqual([]);
    expect(HOST_FEATURES.watch).toContain("calendar");
    expect(HOST_FEATURES.widget).not.toContain("calendar");
  });
});

describe("luminance is read once, at the root, with BOTH initial-value paths", () => {
  it("reads the environment in the root view and never in NodeView", () => {
    // NodeView is instantiated PER NODE: reading `isLuminanceReduced` there
    // would fan one global signal across the whole tree and re-evaluate every
    // node's body on every wrist-down — the exact cost the signal exists to
    // remove, added by the code meant to remove it.
    expect(read(HOST)).toContain(
      "@Environment(\\.isLuminanceReduced) private var isLuminanceReduced",
    );
    expect(read("ReactWatchHost/NodeView.swift")).not.toContain(
      "isLuminanceReduced",
    );
  });

  it("keeps the .onChange(initial:) AND the boot() re-push", () => {
    // Neither is redundant. `.onChange` alone fires only on CHANGE, so an app
    // mounted with the wrist already down would keep its timers running. The
    // `initial: true` push alone can land while `jsReady == false`, where
    // `pushNativeEvent` reaches nobody — and SwiftUI does not order it against
    // `.onAppear { model.start() }`. Deleting either one leaves a silent hole
    // that only shows up as battery drain.
    const src = read(HOST);
    expect(src).toContain(".onChange(of: isLuminanceReduced, initial: true) {");
    expect(src).toContain("model.setLuminanceReduced(isLuminanceReduced)");
    const boot = slice(
      src,
      "private func boot(devCode: String? = nil) {",
      "\n    }\n",
    );
    const ready = boot.indexOf("jsReady = true");
    const push = boot.indexOf("pushLuminanceReduced()");
    expect(ready).toBeGreaterThan(-1);
    // AFTER jsReady, or the push it exists to replay is dropped too.
    expect(push).toBeGreaterThan(ready);
  });

  it("stays a pure push event — no schema entry, no feature", () => {
    // Like scenePhase / openURL / backgroundRefresh, none of which are
    // HostPolicy-gated. A host method would also create a second source of
    // truth for a value that is only ever pushed.
    expect(
      hostMethods.filter((m) => m.name.toLowerCase().includes("luminance")),
    ).toEqual([]);
    expect(hostMethods.map((m) => m.feature)).not.toContain("alwaysOn");
  });

  it("dims a complication by the WIDGET's own knob, not by a JS event", () => {
    // The recorded follow-up to "no widget-side luminance in v1", and the
    // reason it is native: a widget tree renders from a PUBLISHED payload, so
    // there is no JS listener in the extension for a push event to reach.
    // WidgetKit's own knob is `widgetRenderingMode` (watchOS 9.0, verified from
    // the docs JSON), read in the modifier whose output it changes.
    const widget = read("ReactWatchWidget/ReactWidgetView.swift");
    expect(widget).toContain("import WidgetKit");
    const modifier = slice(
      widget,
      "private struct WidgetBackground: ViewModifier {",
      "private struct WidgetFrame",
    );
    expect(modifier).toContain(
      "@Environment(\\.widgetRenderingMode) private var renderingMode",
    );
    // THE rule, and it is not "our colours are ignored": Apple states the
    // system treats the views as template images, replacing the colour "while
    // preserving the view's alpha channel". So a FILLED background survives
    // accented rendering as an opaque block in the face's colour, with the text
    // on it in the same group and therefore the same colour — invisible.
    // Stroking is what keeps the shape legible.
    const accented = code(modifier);
    expect(accented).toContain("renderingMode == .accented");
    // BOTH background branches (with and without a cornerRadius) stroke when
    // accented — counted, because asserting one substring lets the other branch
    // silently go back to filling.
    expect(accented.match(/stroke\(background/g)).toHaveLength(2);
    // …and each still FILLS otherwise, or this traded one wrong rendering for
    // another on every full-colour face.
    expect(accented).toContain("content.background(background, in: shape)");
    expect(accented).toContain("content.background(background)\n");
    // The app has no such environment and must not grow one: this is a
    // complication-appearance concern, not a shared style rule.
    expect(code(read("ReactWatchHost/NodeView.swift"))).not.toContain(
      "widgetRenderingMode",
    );
  });

  it("does not claim scenePhase carries the Always-On state", () => {
    // The docs define no ScenePhase value for it, so an app keying off
    // scenePhase would never see wrist-down. Saying otherwise in a doc comment
    // is how that belief spreads.
    const appState = readSrc("appState.ts");
    expect(appState).toContain("`scenePhase` is not this signal");
    expect(appState).toContain("WKSupportsAlwaysOnDisplay");
  });
});
