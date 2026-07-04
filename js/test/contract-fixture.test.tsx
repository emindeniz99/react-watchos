import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// The codegen schema — the source of truth for the component list, so this
// test can't silently miss a new component.
import { components } from "../codegen/schema.mjs";
import {
  Alert,
  AlertAction,
  Button,
  Chart,
  ConfirmationDialog,
  ContentUnavailable,
  CrownRotation,
  DatePicker,
  Divider,
  Gauge,
  Grid,
  GridRow,
  HStack,
  Image,
  Label,
  LabeledContent,
  List,
  MapView,
  MemoryHost,
  NavigationLink,
  NavigationRoute,
  NavigationStack,
  Picker,
  ProgressView,
  registerControl,
  registerWidget,
  renderWidgets,
  ScrollView,
  Section,
  ShareLink,
  Sheet,
  Slider,
  Spacer,
  Stepper,
  TabView,
  Text,
  TextField,
  TimerText,
  Toggle,
  Toolbar,
  ToolbarItem,
  unregisterAllWidgets,
  VStack,
  WatchRoot,
  ZStack,
} from "../src/index";

// Writes the JSON the Swift ReactWatchCore decoders consume, straight from
// the real serializer — so the cross-language wire contract is checked
// against actual output, never a hand-authored copy. The SwiftPM package's
// `swift test` (ReactWatchTests) decodes these fixtures.
const fixturesDir = join(__dirname, "../swift/Tests/ReactWatchTests/Fixtures");

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
            url: "reactwatch://stopwatch",
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

  // M15: the surfaces where JS and Swift actually meet — every component AND
  // the shared modifier props — used to be covered by hand-built literals on
  // each side, so both could drift with green tests. This kitchen-sink tree is
  // produced by the REAL serializer, asserted complete against the codegen
  // schema (a new component can't be forgotten), and decoded + spot-parsed by
  // Swift's WireContractTests.
  it("writes a kitchen-sink fixture covering every component + modifier props", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <VStack
        spacing={4}
        alignment="leading"
        padding={{ horizontal: 8, vertical: 2 }}
        frame={{ maxWidth: "infinity", height: 120 }}
        background="#00000080"
        cornerRadius={6}
        opacity={0.9}
        tint="accentColor"
        animation={{ kind: "spring", duration: 0.3 }}
        accessibilityLabel="sink-root"
        accessibilityHint="the kitchen sink"
      >
        <HStack spacing={2} alignment="center">
          <Text bold monospacedDigit textStyle="headline" color="green">
            Rich <Text color="#FF8000">segment</Text>
          </Text>
          <TimerText since={1000} milliseconds size={22} />
          <Spacer />
          <Divider />
        </HStack>
        <ZStack alignment="topLeading">
          <Image systemName="drop.fill" size={17} color="blue" />
          <Gauge value={7} min={0} max={10} label="G" style="circular" />
        </ZStack>
        <ScrollView>
          <List>
            <Section header="H" footer="F">
              <Label label="L" systemName="star" color="yellow" />
              <LabeledContent label="LC" value="42" />
            </Section>
          </List>
        </ScrollView>
        <Button glass buttonStyle="glassProminent" onPress={() => {}}>
          <Text>tap</Text>
        </Button>
        <Toggle value={true} label="on" onChange={() => {}} />
        <Slider
          value={0.5}
          from={0}
          through={1}
          step={0.1}
          onChange={() => {}}
        />
        <Stepper value={3} from={0} through={9} onChange={() => {}} />
        <Picker value={1} options={["a", "b"]} label="P" onChange={() => {}} />
        <DatePicker value={1_700_000_000_000} onChange={() => {}} />
        <TextField value="draft" placeholder="type" onChange={() => {}} />
        <CrownRotation value={5} from={0} through={10} onChange={() => {}}>
          <Text>5</Text>
        </CrownRotation>
        <TabView selection={1} onChange={() => {}}>
          <Text>tab</Text>
          <Text>tab 2</Text>
        </TabView>
        <NavigationStack>
          <NavigationRoute path="/">
            <NavigationLink to="/detail/42" label="go" />
          </NavigationRoute>
          <NavigationRoute path="/detail/[id]">
            <Text>detail</Text>
          </NavigationRoute>
        </NavigationStack>
        <Alert presented={false} title="A" message="m" onChange={() => {}}>
          <AlertAction label="OK" role="cancel" onPress={() => {}} />
        </Alert>
        <ConfirmationDialog presented={false} title="C" onChange={() => {}}>
          <AlertAction label="Do" onPress={() => {}} />
        </ConfirmationDialog>
        <Sheet presented={false} onChange={() => {}}>
          <Text>sheet</Text>
        </Sheet>
        <Grid horizontalSpacing={2} verticalSpacing={2}>
          <GridRow>
            <Text>c1</Text>
            <Text>c2</Text>
          </GridRow>
        </Grid>
        <ShareLink item="https://example.test" />
        <Chart
          type="bar"
          color="red"
          points={[
            { x: "mon", y: 1 },
            { x: "tue", y: 2.5 },
          ]}
        />
        <MapView
          latitude={41.0}
          longitude={29.0}
          span={0.05}
          annotations={[{ lat: 41.0, lon: 29.0, title: "here" }]}
        />
        <ProgressView value={0.4} total={1} label="dl" />
        <ContentUnavailable
          title="empty"
          systemName="tray"
          description="nothing yet"
        />
        <Toolbar>
          <ToolbarItem placement="topBarTrailing">
            <Button onPress={() => {}}>
              <Text>t</Text>
            </Button>
          </ToolbarItem>
        </Toolbar>
      </VStack>,
    );
    const tree = host.lastCommit!;

    // Completeness against the SCHEMA (the codegen source of truth): every
    // component the wire knows must appear in this fixture, so adding a
    // component without extending the contract fixture fails here.
    const seen = new Set<string>();
    const walk = (node: { type: string; children: unknown[] }) => {
      seen.add(node.type);
      for (const child of node.children as {
        type: string;
        children: unknown[];
      }[]) {
        walk(child);
      }
    };
    walk(tree.root as never);
    const missing = (components as { name: string }[])
      .map((c) => c.name)
      .filter((name) => !seen.has(name));
    expect(missing).toEqual([]);

    mkdirSync(fixturesDir, { recursive: true });
    writeFileSync(
      join(fixturesDir, "kitchen-sink.json"),
      `${JSON.stringify(tree, null, 2)}\n`,
    );
  });
});
