import {
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
export function daypartEntries(
  now: number,
): Array<{ date: number; part: Daypart }> {
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
        entries: [{ date: now, view }],
        reloadAfter: now + 24 * 3_600_000,
      };
    },
  });

  // Multi-entry timeline: WidgetKit swaps to the pre-rendered future
  // entries on schedule, with no app involvement. Relevance scores hint
  // the Smart Stack when to surface it.
  registerWidget({
    kind: "daypart",
    families: ["accessoryRectangular", "accessoryInline"],
    render: ({ family, now }) => ({
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

  // watchOS 26 Control Center / Action button control. The OS templates
  // the visual; React owns the metadata and the intent handler
  // (demo/intents.ts) that runs when it's pressed.
  registerControl({
    kind: "hydration.addGlass",
    intent: "addGlass",
    label: "Add Glass",
    systemName: "drop.fill",
  });
}
