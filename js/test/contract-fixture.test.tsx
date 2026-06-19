import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CrownRotation,
  Gauge,
  MemoryHost,
  registerControl,
  registerWidget,
  renderWidgets,
  Text,
  TimerText,
  Toggle,
  unregisterAllWidgets,
  VStack,
  WatchRoot,
} from "../src/index";

// Writes the JSON the Swift ReactWatchCore decoders consume, straight from
// the real serializer — so the cross-language wire contract is checked
// against actual output, never a hand-authored copy. The SwiftPM package's
// `swift test` (ReactWatchTests) decodes these fixtures.
const fixturesDir = join(
  __dirname,
  "../../swift/Tests/ReactWatchTests/Fixtures",
);

afterEach(() => unregisterAllWidgets());

describe("swift contract fixtures", () => {
  it("writes a commit-tree fixture (incl. TimerText) for NodeModel", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <VStack spacing={8}>
        <TimerText since={1000} bold size={28} color="green" />
        <Toggle value={true} label="Live" onChange={() => {}} />
        <CrownRotation
          value={5}
          from={0}
          through={10}
          step={1}
          onChange={() => {}}
        >
          <Text>5</Text>
        </CrownRotation>
        <Text>Connected</Text>
      </VStack>,
    );
    const tree = host.lastCommit!;
    expect(tree.v).toBe(1);
    expect(tree.root!.type).toBe("VStack");

    mkdirSync(fixturesDir, { recursive: true });
    writeFileSync(
      join(fixturesDir, "tree.json"),
      `${JSON.stringify(tree, null, 2)}\n`,
    );
  });

  it("writes a publishWidgets fixture for WidgetModels", () => {
    registerWidget({
      kind: "stopwatch",
      families: ["accessoryCircular", "accessoryInline"],
      render: ({ now }) => ({
        entries: [
          {
            date: now,
            relevance: { score: 50, durationMs: 3_600_000 },
            view: <Gauge value={0.5} label="Go" style="circular" />,
          },
        ],
        reloadAfter: now + 3_600_000,
      }),
    });
    registerControl({
      kind: "sw.start",
      intent: "start",
      label: "Start",
      systemName: "play.fill",
    });
    const payload = renderWidgets(1000);
    expect(payload.widgets.stopwatch).toBeDefined();

    mkdirSync(fixturesDir, { recursive: true });
    writeFileSync(
      join(fixturesDir, "widgets.json"),
      `${JSON.stringify(payload, null, 2)}\n`,
    );
  });
});
