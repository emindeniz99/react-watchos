import {
  deepLinkURL,
  Gauge,
  HStack,
  Image,
  ProgressView,
  registerControl,
  registerWidget,
  Text,
  VStack,
} from "../src/index";
import { hydrationStore } from "./hydrationStore";
import { findShoppingList, getShoppingLists } from "./shoppingStore";

interface Daypart {
  name: string;
  systemName: string;
  startHour: number;
  score: number;
}

const NIGHT: Daypart = {
  name: "Night",
  systemName: "moon.stars.fill",
  startHour: 0,
  score: 10,
};
const DAYPARTS: Daypart[] = [
  NIGHT,
  { name: "Morning", systemName: "sunrise.fill", startHour: 6, score: 80 },
  { name: "Afternoon", systemName: "sun.max.fill", startHour: 12, score: 60 },
  { name: "Evening", systemName: "sunset.fill", startHour: 18, score: 40 },
];

function daypartAt(date: Date): Daypart {
  const hour = date.getHours();
  return [...DAYPARTS].reverse().find((p) => hour >= p.startHour) ?? NIGHT;
}

/** The current daypart (dated now) plus every boundary in the next 24h. */
function daypartEntries(now: number): Array<{ date: number; part: Daypart }> {
  const entries = [{ date: now, part: daypartAt(new Date(now)) }];
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    for (const part of DAYPARTS) {
      const boundary = new Date(now);
      boundary.setDate(boundary.getDate() + dayOffset);
      boundary.setHours(part.startHour, 0, 0, 0);
      const ms = boundary.getTime();
      if (ms > now && ms <= now + 24 * 3_600_000) {
        entries.push({ date: ms, part });
      }
    }
  }
  return entries.sort((a, b) => a.date - b.date);
}

/**
 * Hydration complication. One React render function covers every
 * accessory family (circular and corner complications, the rectangular
 * Smart Stack widget, and the inline text slot). The app re-publishes on
 * every change; reloadAfter asks WidgetKit for a daily refresh anyway.
 */
export function registerDemoWidgets(): void {
  registerWidget({
    kind: "hydration",
    families: [
      "accessoryCircular",
      "accessoryCorner",
      "accessoryRectangular",
      "accessoryInline",
    ],
    render: ({ family, now }) => {
      const { glasses, goal } = hydrationStore;
      const view = (() => {
        switch (family) {
          case "accessoryCircular":
          case "accessoryCorner":
            return (
              <Gauge
                value={glasses}
                min={0}
                max={goal}
                label="Water"
                style="circular"
              />
            );
          case "accessoryRectangular":
            return (
              <VStack spacing={2}>
                <HStack spacing={4}>
                  <Image systemName="drop.fill" color="cyan" />
                  <Text bold>Hydration</Text>
                </HStack>
                <Text size={12}>{`${glasses} of ${goal} glasses`}</Text>
                <ProgressView value={glasses} total={goal} />
              </VStack>
            );
          case "accessoryInline":
            return <Text>{`Water ${glasses}/${goal}`}</Text>;
        }
      })();
      return {
        entries: [{ date: now, view, url: deepLinkURL("/hydration") }],
        reloadAfter: now + 24 * 3_600_000,
      };
    },
  });

  // Shopping complication. One timeline per list (key "shopping/<id>"), so the
  // native AppIntentConfiguration can show whichever list the user picks while
  // editing the watch face. Both the app and the extension's fresh render read
  // the lists from App Group storage, so the face reflects live edits.
  registerWidget({
    kind: "shopping",
    families: [
      "accessoryCircular",
      "accessoryCorner",
      "accessoryRectangular",
      "accessoryInline",
    ],
    instances: () => getShoppingLists().map((list) => list.id),
    render: ({ family, now, instanceId }) => {
      const list =
        (instanceId ? findShoppingList(instanceId) : undefined) ??
        getShoppingLists()[0];
      const done = list ? list.items.filter((item) => item.done).length : 0;
      const total = list ? list.items.length : 0;
      const name = list?.name ?? "Shopping";
      const view = (() => {
        switch (family) {
          case "accessoryCircular":
          case "accessoryCorner":
            return (
              <Gauge
                value={done}
                min={0}
                max={Math.max(total, 1)}
                label="List"
                style="circular"
              />
            );
          case "accessoryRectangular":
            return (
              <VStack spacing={2}>
                <HStack spacing={4}>
                  <Image systemName="checklist" color="cyan" />
                  <Text bold>{name}</Text>
                </HStack>
                <Text size={12}>{`${done} of ${total} done`}</Text>
                <ProgressView value={done} total={Math.max(total, 1)} />
              </VStack>
            );
          case "accessoryInline":
            return <Text>{`${name} ${done}/${total}`}</Text>;
        }
      })();
      return {
        entries: [
          {
            date: now,
            view,
            url: list ? deepLinkURL(`/list/${list.id}`) : deepLinkURL("/"),
          },
        ],
        reloadAfter: now + 6 * 3_600_000,
      };
    },
  });

  // Multi-entry timeline: WidgetKit swaps to the pre-rendered future
  // entries on schedule, with no app involvement.
  //
  // Two DIFFERENT Smart Stack signals are in play here, and they are easy to
  // confuse:
  //  - per-entry `relevance` = the RANKING score, "how prominent is this
  //    widget once the stack is already showing it".
  //  - `relevantContexts` = the PREDICTIVE hint, "when/where should the system
  //    surface it at all". These are clues for the on-device ranker, not a
  //    schedule: publishing one costs a few bytes and no wakeups.
  registerWidget({
    kind: "daypart",
    families: ["accessoryRectangular", "accessoryInline"],
    render: ({ family, now }) => ({
      // Surface near each upcoming daypart boundary (the moment the face is
      // about to change) and near the demo's "gym" geofence — plus the clue
      // families that need no coordinates at all. `poi` and `dateKind` are
      // watchOS 26.0 and are dropped natively below it; the rest are watchOS
      // 10.0, i.e. free at this package's floor.
      relevantContexts: [
        ...daypartEntries(now)
          .slice(1)
          .map(({ date }) => ({ kind: "date" as const, date })),
        {
          kind: "location" as const,
          latitude: 37.3349,
          longitude: -122.009,
          radius: 150,
        },
        { kind: "poi" as const, category: "fitnessCenter" as const },
        { kind: "inferredLocation" as const, place: "home" as const },
        { kind: "fitness" as const, condition: "activityRingsIncomplete" },
        { kind: "sleep" as const, condition: "bedtime" as const },
      ],
      entries: daypartEntries(now).map(({ date, part }) => ({
        date,
        relevance: { score: part.score, durationMs: 6 * 3_600_000 },
        view:
          family === "accessoryRectangular" ? (
            <VStack spacing={2}>
              <HStack spacing={4}>
                <Image systemName={part.systemName} color="yellow" />
                <Text bold>{part.name}</Text>
              </HStack>
              <Text size={12} color="secondary">
                Rendered ahead by React
              </Text>
            </VStack>
          ) : (
            <Text>{`${part.name} on the watch`}</Text>
          ),
      })),
      reloadAfter: now + 24 * 3_600_000,
    }),
  });

  // watchOS 26 Control Center / Action button controls. The OS templates the
  // visual; React owns the metadata and the intent handler (demo/intents.ts)
  // that runs when it's used. Both controls are DECLARED in Swift
  // (targets/widget/ReactWidgets.swift) — registerControl re-labels a control,
  // it cannot create one.
  registerControl({
    kind: "hydration.addGlass",
    intent: "addGlass",
    label: "Add Glass",
    systemName: "drop.fill",
    // Shown by ControlWidgetButton while the intent runs.
    actionLabel: "Adding…",
  });

  // A ControlWidgetToggle: `value` publishes the CURRENT state, which is what
  // makes its presence the "this is a toggle" marker. The Swift side is a
  // SetValueIntent that dispatches remindersOn/remindersOff.
  //
  // A GETTER, not `value: hydrationStore.remindersEnabled` — registerControl
  // runs once at startup, so a literal would freeze the very first state and
  // the toggle would draw itself stuck no matter how often the user flipped it.
  // The getter is re-read on every publish, like a widget's render().
  registerControl({
    kind: "hydration.reminders",
    intent: "reminders",
    label: "Hydration Reminders",
    systemName: "bell.badge.fill",
    value: () => hydrationStore.remindersEnabled,
  });
}
