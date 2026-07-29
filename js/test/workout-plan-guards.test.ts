import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostMethods } from "../codegen/schema";
import { HOST_FEATURES } from "../src/generated/wire";

/**
 * Negative checks for the guards the WORKOUTKIT PLAN package adds — the cases
 * each one exists to REFUSE, rather than the happy path the contract fixtures
 * already cover.
 *
 * Most of them live in `#if os(watchOS)` code no Linux job can compile, so they
 * are scanned textually, exactly as `health-package-guards.test.ts` does and for
 * the same reason: a textual scan is weaker than a compile, and stronger than
 * the nothing these rules would otherwise have. The two invariants this file
 * exists for are the two the design turns on — the bridge is STATELESS and must
 * never reach for the session owner, and every mutation is verified by
 * READ-BACK because Apple's mutators have no error channel at all.
 */

const swiftRoot = join(__dirname, "../swift/Sources");
const read = (rel: string) => readFileSync(join(swiftRoot, rel), "utf8");

const BRIDGE = "ReactWatchHost/WorkoutPlanBridge.swift";
const HOST = "ReactWatchHost/ReactWatchHost.swift";
const SPEC = "ReactWatchSupport/WorkoutPlanSpec.swift";

/** One Swift member function's body: its declaration line to the first line
 *  that closes at member (four-space) indentation. */
function functionBody(src: string, decl: string): string {
  const start = src.indexOf(decl);
  expect(start, `no Swift function declared \`${decl}\``).toBeGreaterThan(-1);
  const end = src.indexOf("\n    }\n", start);
  expect(end, `\`${decl}\` never closes at member indentation`).toBeGreaterThan(
    -1,
  );
  return src.slice(start, end);
}

/** The file with comment-only lines dropped — every assertion here is about
 *  CODE, and this file's sources are heavily commented with the very strings
 *  being asserted on. */
function code(src: string): string {
  return src
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

describe("the plan bridge is stateless and never reaches for the session", () => {
  it("never names WorkoutSessionOwner or builds a workout session", () => {
    // THE HAZARD, stated plainly: a file called `WorkoutPlanBridge` sitting
    // next to `WorkoutBridge` is exactly where a future contributor would
    // wrongly reach for the single HKWorkoutSession — to "start the workout
    // the plan describes", say. WorkoutKit is a DOCUMENT api: a WorkoutPlan is
    // an immutable value, the scheduler is a store, and nothing runs. Taking
    // the session here would break the single-construction-site invariant
    // watchOS's one-session-per-process rule depends on, and its symptom would
    // be the user's heart-rate stream dying mid-workout.
    const src = code(read(BRIDGE));
    expect(src).not.toContain("WorkoutSessionOwner");
    expect(src).not.toContain("HKWorkoutSession(");
    expect(src).not.toContain("HKLiveWorkoutBuilder");
    expect(src).not.toContain("workoutOwner");
    // ...and no mutable stored state at all: every op is one
    // `WorkoutScheduler.shared` round trip, so there is nothing to tear down,
    // no generation to guard inside the bridge, and no deinit obligation.
    expect(src).not.toMatch(/^ {4}(private )?var \w+/m);
  });

  it("the host owns it as a plain property with no teardown obligation", () => {
    const src = code(read(HOST));
    expect(src).toContain("private let workoutPlans = WorkoutPlanBridge()");
    // The workout owner is torn down on a runtime reload because it holds a
    // live system resource. This one holds nothing, so appearing in
    // tearDownGeneration would be cargo-culted ceremony — and worse, would
    // imply the scheduler's contents are ours to clear on a reload. They are
    // not: a scheduled plan outlives the process.
    const teardown = code(
      functionBody(read(HOST), "    private func tearDownGeneration() {"),
    );
    expect(teardown).not.toContain("workoutPlans");
  });
});

describe("every scheduler mutation is verified by read-back", () => {
  // Apple's three mutators are `async`, non-throwing, and return Void:
  //     final func schedule(_:at:) async
  //     final func remove(_:at:) async
  //     final func removeAllWorkouts() async
  // A naked await resolves identically whether the plan was stored, the user
  // denied authorization, the device is over quota, or `isSupported` is false.
  // That is the `ok == true` meaning "the sheet completed" bug the health
  // package spent four commits removing, one framework over.
  // `bind` is the name the re-read is stored under, and it is pinned on
  // purpose: the outcome has to be DERIVED from the read, and a name is the
  // cheapest textual evidence that it was.
  const MUTATIONS: { decl: string; call: string; bind: string }[] = [
    {
      decl: "    func schedule(",
      call: "await scheduler.schedule(plan, at: at)",
      bind: "stored",
    },
    {
      decl: "    func remove(",
      call: "await scheduler.remove(target.plan, at: target.date)",
      bind: "after",
    },
    {
      decl: "    func removeAll() async -> Outcome {",
      call: "await scheduler.removeAllWorkouts()",
      bind: "after",
    },
  ];

  for (const { decl, call, bind } of MUTATIONS) {
    it(`${call} settles on a re-read of scheduledWorkouts`, () => {
      const body = code(functionBody(read(BRIDGE), decl));
      const mutation = body.indexOf(call);
      expect(
        mutation,
        `${call} is gone — did the mutation move?`,
      ).toBeGreaterThan(-1);
      // The read-back has to come AFTER the write. A read before it (the quota
      // check, the remove target lookup) proves nothing about what landed.
      const readBack = body.indexOf(
        `let ${bind} = await scheduler.scheduledWorkouts`,
        mutation,
      );
      expect(
        readBack,
        `${call} settles without re-reading the scheduler`,
      ).toBeGreaterThan(mutation);
      // ...and ORDER IS NOT ENOUGH. `_ = await scheduler.scheduledWorkouts`
      // sits after the write and proves nothing: the op would resolve success
      // for a scheduler that stored nothing, which is the one bug this whole
      // package's read-back exists to prevent and the one no Linux job can
      // compile its way to. So the read is bound, the guard's CONDITION names
      // that binding, and the arm it falls into can actually refuse.
      const guarded = body.indexOf("guard", readBack);
      expect(
        guarded,
        `${call} discards the read-back instead of guarding on it`,
      ).toBeGreaterThan(readBack);
      const otherwise = body.indexOf("else", guarded);
      expect(
        body.slice(guarded, otherwise),
        `${call}'s guard does not test \`${bind}\` — the read-back is decorative`,
      ).toContain(bind);
      expect(
        body.slice(otherwise),
        `${call} has no refusal arm — a failed read-back cannot reject`,
      ).toContain(".unavailable(");
    });
  }

  it("a scheduler that accepted nothing rejects UNAVAILABLE, honestly worded", () => {
    // The refusal a caller has to be able to act on, and the one this whole
    // package is uncertain about: nothing in Apple's docs contradicts
    // watch-side scheduling and nothing confirms it either. If the scheduler
    // stores nothing, the message says that rather than pretending success.
    const src = read(BRIDGE);
    expect(src).toContain("the scheduler accepted nothing");
    expect(src).toContain("watch-side scheduling may be");
    expect(src).toContain("the scheduler removed nothing");
  });

  it("asks authorizationState before blaming the platform", () => {
    // `isSupported` is a DEVICE flag and stays true after the user taps Don't
    // Allow, so a denial lands in the read-back failure branch. Blaming
    // watch-side scheduling there would misdiagnose the likeliest real failure
    // as the one thing this package cannot verify — and would poison the sim
    // spike, which reads that message as its evidence.
    const body = code(functionBody(read(BRIDGE), "    func schedule("));
    const mutation = body.indexOf("await scheduler.schedule(");
    const asked = body.indexOf("await scheduler.authorizationState", mutation);
    const platformBlame = body.indexOf("Self.acceptedNothingMessage)", asked);
    expect(
      asked,
      "the failure branch never reads authorizationState",
    ).toBeGreaterThan(mutation);
    expect(
      platformBlame,
      "the platform message is not gated behind the authorization check",
    ).toBeGreaterThan(asked);
  });

  it("refuses an (id, minute) already scheduled, so the read-back is not vacuous", () => {
    // `matches` is a KEY test — id plus minute, nothing about the composition.
    // So if that pair is ALREADY stored when `schedule` is called, the read-back
    // below finds the old entry no matter what the write did, and the invoke
    // resolves a summary whether WorkoutKit replaced the plan, ignored the
    // second call, or stored a duplicate. Apple documents none of the three:
    // `schedule(_:at:)`'s docs JSON says only "Schedules the provided workout at
    // the specified date." Refusing the collision BEFORE the mutation is what
    // makes the pair provably absent beforehand — which is the only thing that
    // turns "it is there afterwards" into "this call stored it".
    const body = code(functionBody(read(BRIDGE), "    func schedule("));
    const refused = body.indexOf("!existing.contains(where:");
    expect(
      refused,
      "the (id, minute) collision is not refused — the read-back confirms itself",
    ).toBeGreaterThan(-1);
    expect(
      body.indexOf("await scheduler.schedule("),
      "the collision refusal must precede the mutation, like the quota does",
    ).toBeGreaterThan(refused);
  });

  it("the read-back keys on the plan id, not just the minute", () => {
    // The other half of the `(id, minute)` key, and the half with teeth: drop
    // it and `matches` answers "yes" for ANY plan sitting at that minute. The
    // read-back would then confirm a DIFFERENT plan's write as this one's, and
    // `remove(_:calendar:)` would resolve `true` after deleting somebody else's
    // scheduled workout — silent, user-visible data loss, in the one file no
    // Linux job compiles.
    const matches = code(
      functionBody(read(BRIDGE), "    private static func matches("),
    );
    expect(matches).toContain("scheduled.plan.id == id");
  });

  it("the read-back compares the minute, not raw DateComponents", () => {
    // Apple may normalise the components it stores (an era, a calendar, a time
    // zone we never set). A raw `DateComponents ==` would then be a FALSE
    // NEGATIVE reported to the caller as "the scheduler accepted nothing" —
    // the worst possible failure for a check whose whole job is honesty. Both
    // sides go through the one Linux-tested round-trip pair instead.
    const matches = code(
      functionBody(read(BRIDGE), "    private static func matches("),
    );
    expect(matches).toContain("WorkoutPlanSchedule.minuteMs(");
    expect(matches).toContain("WorkoutPlanSchedule.milliseconds(");
    expect(matches).not.toContain("scheduled.date ==");
  });

  it("remove passes the STORED key, never one rebuilt from ref.atMs", () => {
    // The flip side of the tolerance above. `matches` is loose on purpose, so
    // the entry it finds may be a NORMALISED one whose components are not the
    // ones we would rebuild from `ref.atMs` — SupportTests asserts we never
    // build a `timeZone`/`calendar`/`era` and that a stored entry carrying them
    // still matches. `remove(_:at:)` gets none of that tolerance: it is
    // non-throwing and returns Void, so a key that misses leaves a plan that
    // can never be removed by id again — recoverable only by
    // `removeAllWorkouts()`, which destroys the user's other scheduled
    // workouts. The authoritative key is already bound one line above.
    const body = code(functionBody(read(BRIDGE), "    func remove("));
    expect(body).toContain(
      "await scheduler.remove(target.plan, at: target.date)",
    );
    expect(
      body,
      "remove rebuilt the scheduler key from ref.atMs instead of using target.date",
    ).not.toContain("WorkoutPlanSchedule.components(");
  });
});

describe("the quota is Apple's number, read at runtime", () => {
  it("reads maxAllowedScheduledWorkoutCount and hardcodes nothing", () => {
    // The only public figure ("up to 15 workouts at a time") is a WWDC23 line
    // three years old, and the constant's value is not in Apple's docs JSON at
    // all. Hardcoding it would be a second source of truth that silently
    // refuses legal schedules the day Apple raises the cap.
    const src = code(read(BRIDGE));
    expect(src).toContain("WorkoutScheduler.maxAllowedScheduledWorkoutCount");
    expect(src).not.toMatch(/\b15\b/);
    // Refused BEFORE the mutation: `schedule` has no error channel, so an
    // over-quota call would otherwise be a silent no-op the read-back could
    // only report as "accepted nothing" — true, but useless.
    const body = code(functionBody(read(BRIDGE), "    func schedule("));
    expect(body.indexOf("maxAllowedScheduledWorkoutCount")).toBeLessThan(
      body.indexOf("await scheduler.schedule("),
    );
  });
});

describe("Apple's legality checks run before the plan is built", () => {
  it("supportsActivity gates each kind before its initializer", () => {
    // The matrix is documented NOWHERE, is not stable across activity ×
    // location, and has confirmed-in-the-wild traps. `supports*` exists for
    // exactly this question, so our code asks rather than guessing — root rule
    // 5, with Apple's binary as the code that answers.
    const body = code(functionBody(read(BRIDGE), "    static func plan("));
    for (const [check, build] of [
      [
        "CustomWorkout.supportsActivity(activity)",
        "let workout = CustomWorkout(",
      ],
      [
        "SingleGoalWorkout.supportsActivity(activity)",
        "let workout = SingleGoalWorkout(",
      ],
      [
        "PacerWorkout.supportsActivity(activity)",
        "let workout = PacerWorkout(",
      ],
    ]) {
      const asked = body.indexOf(check as string);
      const built = body.indexOf(build as string);
      expect(asked, `${check} is not asked at all`).toBeGreaterThan(-1);
      expect(built).toBeGreaterThan(asked);
    }
  });

  it("every goal and alert is checked before the step is constructed", () => {
    const body = code(
      functionBody(read(BRIDGE), "    private static func step("),
    );
    const goal = body.indexOf("CustomWorkout.supportsGoal(");
    const alert = body.indexOf("CustomWorkout.supportsAlert(");
    const built = body.indexOf("return .success(WorkoutStep(");
    expect(goal).toBeGreaterThan(-1);
    expect(alert).toBeGreaterThan(goal);
    expect(built).toBeGreaterThan(alert);
  });

  it("a refusal names the failing element by path", () => {
    // "not supported" without a path is unactionable in a plan with six blocks
    // of four steps. The path prefixes are built in Support and consumed here.
    const bridge = read(BRIDGE);
    expect(bridge).toContain('"\\(path).goal: ');
    expect(bridge).toContain('"\\(path).alert: ');
    expect(bridge).toContain(
      "plan.blocks[\\(blockIndex)].steps[\\(stepIndex)]",
    );
    // The documented-in-the-wild trap gets NAMED: "energy is not supported"
    // reads as a device limitation when it is a workout-KIND limitation.
    expect(bridge).toContain(
      "energy goals are legal only on kind:'singleGoal'",
    );
  });
});

describe("authorization reads before it prompts", () => {
  it("only calls requestAuthorization when the state is notDetermined", () => {
    // The house contract (`requestCalendarAccess`) is that calling again
    // returns the standing status without re-prompting — but Apple does not
    // document whether `requestAuthorization()` re-prompts, and assuming it
    // behaves like HealthKit is the class of guess this codebase keeps
    // removing. Two lines make the contract true by construction.
    const body = code(
      functionBody(read(BRIDGE), "    func requestAuthorization("),
    );
    const standing = body.indexOf("await scheduler.authorizationState");
    const guardLine = body.indexOf("guard standing == .notDetermined else");
    const prompt = body.indexOf("await scheduler.requestAuthorization()");
    expect(standing).toBeGreaterThan(-1);
    expect(guardLine).toBeGreaterThan(standing);
    expect(prompt).toBeGreaterThan(guardLine);
  });

  it("an unknown future state degrades to notDetermined, not to a verdict", () => {
    // A fifth case is a wire change. Mapping it to `denied` would tell a
    // caller the user refused something they were never asked.
    const body = code(
      functionBody(read(BRIDGE), "    private static func name("),
    );
    expect(body).toContain('@unknown default: "notDetermined"');
  });
});

describe("the isSupported refusal exists exactly once, and not on open", () => {
  it("guards every scheduler op", () => {
    const src = read(BRIDGE);
    for (const decl of [
      "    func requestAuthorization(",
      "    func schedule(",
      "    func scheduledSummaries(",
      "    func remove(",
      "    func removeAll() async -> Outcome {",
    ]) {
      expect(
        code(functionBody(src, decl)),
        `${decl} does not check isSupported`,
      ).toContain("guard Self.isSupported else");
    }
  });

  it("does NOT guard openInWorkoutApp", () => {
    // `isSupported` answers "does this device support SCHEDULED workouts".
    // Opening a plan in the Workout app is a different question, and gating it
    // on the scheduler's flag would refuse the one half of this package that
    // is watch-native beyond doubt.
    const body = code(
      functionBody(read(BRIDGE), "    func open(_ spec: WorkoutPlanSpec)"),
    );
    expect(body).not.toContain("Self.isSupported");
    expect(body).toContain("plan.openInWorkoutApp()");
  });

  it("the host does not keep a second copy of the same gate", () => {
    // One gate, in the file that knows the answer. A duplicate in the host
    // would drift the day the rule changes.
    expect(code(read(HOST))).not.toContain("WorkoutPlanBridge.isSupported");
  });
});

describe("the calendar is passed in, never read inside the conversion", () => {
  it("the host supplies Calendar.current at every call site", () => {
    // That is what makes the atMs <-> DateComponents pair a pure function of
    // its arguments, and therefore the one thing in this family `swift test`
    // can actually prove on Linux.
    const src = code(read(HOST));
    for (const call of [
      "bridge.schedule(spec, calendar: .current)",
      "bridge.scheduledSummaries(calendar: .current)",
      "bridge.remove(ref, calendar: .current)",
    ]) {
      expect(src).toContain(call);
    }
    expect(code(read(BRIDGE))).not.toContain("Calendar.current");
  });

  it("the conversion lives in Support with a fixed field set", () => {
    const spec = code(read(SPEC));
    expect(spec).toContain(
      "public static let fields: Set<Calendar.Component> = [",
    );
    expect(spec).toContain(".year, .month, .day, .hour, .minute,");
    // Both directions in one place: an inverse written elsewhere could not be
    // proven to be an inverse.
    expect(spec).toContain("public static func components(");
    expect(spec).toContain("public static func milliseconds(");
    expect(spec).toContain("public static func minuteMs(");
  });
});

describe("a plan id is a UUID or the request is refused", () => {
  it("Support parses it rather than substituting a fresh one", () => {
    const spec = code(read(SPEC));
    expect(spec).toContain("UUID(uuidString: raw)");
    expect(spec).toContain("is not a UUID");
    // The reason, in the message: schedule/list/remove all key on the id, so a
    // silent substitution makes removal a permanent no-op nobody can see.
    expect(read(SPEC)).toContain(
      "scheduling, listing and removal all key on it",
    );
  });
});

describe("the workoutPlans feature is watch-only and its own unit", () => {
  it("no plan method reaches the widget runtime", () => {
    // Not a special case — a consequence. `HostInvokeFeatures.byMethod` is
    // built from ALL invoke methods, and WidgetIntentRuntime's typed rejecter
    // answers UNAVAILABLE for any feature outside HostFeatures.widget. A
    // permission sheet inside getTimeline is a non-starter anyway.
    const widgetExposed = hostMethods.filter(
      (m) => m.targets.includes("widget") && m.feature === "workoutPlans",
    );
    expect(widgetExposed).toEqual([]);
    expect(HOST_FEATURES.widget).not.toContain("workoutPlans");
    expect(HOST_FEATURES.watch).toContain("workoutPlans");
  });

  it("is not folded into `workouts`", () => {
    // ARCH-07's authorization-unit test, and both halves pass: a plan writes no
    // health data, occupies no system resource, grants no background execution
    // — and carries its OWN independently-grantable consent, which is the axis
    // on which the pedometer stayed under `sensors`.
    const plans = hostMethods.filter((m) => m.feature === "workoutPlans");
    expect(plans.map((m) => m.name).sort()).toEqual([
      "listScheduledWorkoutPlans",
      "openWorkoutPlanInWorkoutApp",
      "removeAllScheduledWorkoutPlans",
      "removeScheduledWorkoutPlan",
      "requestWorkoutPlanAuthorization",
      "scheduleWorkoutPlan",
    ]);
    for (const method of plans) expect(method.targets).toEqual(["watch"]);
  });

  it("the two user-mediated calls raise the watchdog", () => {
    // Both block on a person: the permission sheet, and `openInWorkoutApp`
    // which LAUNCHES the Workout app (Apple does not document when it
    // returns). The 30 s default would reject a granted permission.
    const src = readFileSync(join(__dirname, "../src/workoutPlans.ts"), "utf8");
    for (const method of [
      "requestWorkoutPlanAuthorization",
      "openWorkoutPlanInWorkoutApp",
    ]) {
      const call = src.slice(
        src.indexOf(`invoke<`, src.indexOf(`"${method}"`) - 200),
      );
      expect(
        call.slice(0, 400),
        `${method} does not raise the watchdog`,
      ).toContain("USER_MEDIATED_INVOKE_TIMEOUT_MS");
    }
  });
});
