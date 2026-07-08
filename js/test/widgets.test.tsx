import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Gauge,
  publishWidgets,
  registerControl,
  registerWidget,
  renderToTree,
  renderWidgets,
  Text,
  unregisterAllWidgets,
  VStack,
} from "../src/index";
import { installMockHost } from "./helpers";

afterEach(() => {
  unregisterAllWidgets();
  delete (globalThis as Record<string, unknown>).__host;
});

describe("renderToTree", () => {
  it("renders an element to a serialized tree without a live root", () => {
    const tree = renderToTree(
      <VStack spacing={2}>
        <Text bold>hi</Text>
      </VStack>,
    );
    expect(tree).toMatchObject({
      type: "VStack",
      props: { spacing: 2 },
      children: [{ type: "Text", props: { bold: true, text: "hi" } }],
    });
  });

  it("returns null for a null element", () => {
    expect(renderToTree(null)).toBeNull();
  });
});

describe("widget timelines", () => {
  const NOW = 1_750_000_000_000;

  function registerHydration(glasses: number) {
    registerWidget({
      kind: "hydration",
      families: ["accessoryCircular", "accessoryInline"],
      render: ({ family, now }) => ({
        entries: [
          {
            date: now,
            url: "reactwatch://hydration",
            view:
              family === "accessoryCircular" ? (
                <Gauge value={glasses} min={0} max={8} label="Water" />
              ) : (
                <Text>{`${glasses}/8 glasses`}</Text>
              ),
          },
        ],
        reloadAfter: new Date(now + 3_600_000),
      }),
    });
  }

  it("renders one timeline per registered family with the family in context", () => {
    registerHydration(3);
    const payload = renderWidgets(NOW);

    expect(payload).toMatchObject({ v: 1, publishedAt: NOW });
    const families = payload.widgets.hydration;
    expect(Object.keys(families).sort()).toEqual([
      "accessoryCircular",
      "accessoryInline",
    ]);
    expect(families.accessoryCircular.entries[0].tree).toMatchObject({
      type: "Gauge",
      props: { value: 3, max: 8 },
    });
    expect(families.accessoryInline.entries[0].tree).toMatchObject({
      type: "Text",
      props: { text: "3/8 glasses" },
    });
    expect(families.accessoryInline.entries[0].url).toBe(
      "reactwatch://hydration",
    );
  });

  it("normalizes Date entries and reloadAfter to epoch milliseconds", () => {
    registerHydration(1);
    const timeline = renderWidgets(NOW).widgets.hydration.accessoryInline;
    expect(timeline.entries[0].date).toBe(NOW);
    expect(timeline.reloadAfter).toBe(NOW + 3_600_000);
  });

  it("floors a sub-5-minute reloadAfter to protect the WidgetKit budget", () => {
    // WidgetKit never honors a sub-few-minute complication cadence anyway, and
    // each honored reload re-renders the tree in the extension — so a tiny/past
    // reloadAfter is clamped rather than forwarded verbatim to native.
    registerWidget({
      kind: "spammy",
      families: ["accessoryInline"],
      render: ({ now }) => ({
        entries: [{ date: now, view: <Text>hi</Text> }],
        reloadAfter: now + 1_000, // 1s — well below the 5min floor
      }),
    });
    const timeline = renderWidgets(NOW).widgets.spammy.accessoryInline;
    expect(timeline.reloadAfter).toBe(NOW + 5 * 60 * 1000);
  });

  it("re-registering a kind replaces its definition", () => {
    registerHydration(1);
    registerHydration(5);
    const tree =
      renderWidgets(NOW).widgets.hydration.accessoryCircular.entries[0].tree;
    expect(tree?.props.value).toBe(5);
  });

  it("one widget's render() throwing does not drop the healthy widgets", () => {
    registerWidget({
      kind: "broken",
      families: ["accessoryInline"],
      render: () => {
        throw new Error("boom");
      },
    });
    registerHydration(2);
    // Silence the expected per-widget error log.
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const payload = renderWidgets(NOW);
    spy.mockRestore();
    // The broken kind is skipped; the healthy one still published.
    expect(payload.widgets.broken).toBeUndefined();
    expect(
      payload.widgets.hydration.accessoryInline.entries[0].tree,
    ).toMatchObject({ type: "Text", props: { text: "2/8 glasses" } });
  });

  it("publishWidgets hands the JSON payload to the native host", () => {
    registerHydration(4);
    const host = installMockHost();

    const payload = publishWidgets(NOW);

    expect(host.publishWidgets).toHaveBeenCalledTimes(1);
    expect(JSON.parse(host.publishWidgets.mock.calls[0][0])).toEqual(
      JSON.parse(JSON.stringify(payload)),
    );
  });

  it("ignores publishWidgets from inside a widget render (reload-loop guard)", () => {
    const host = installMockHost();
    registerWidget({
      kind: "selfPublisher",
      families: ["accessoryInline"],
      render: ({ now }) => {
        // A buggy widget render publishing would otherwise trigger
        // WidgetCenter reload -> getTimeline -> render -> publish forever.
        publishWidgets(now);
        return { entries: [{ date: now, view: <Text>ok</Text> }] };
      },
    });

    const payload = publishWidgets(NOW);

    expect(host.publishWidgets).toHaveBeenCalledTimes(1);
    expect(host.log).toHaveBeenCalledWith(
      expect.stringContaining("reload loop"),
    );
    expect(
      payload.widgets.selfPublisher.accessoryInline.entries[0].tree?.props.text,
    ).toBe("ok");
  });

  it("publishWidgets still renders when the host lacks widget support", () => {
    registerHydration(2);
    const payload = publishWidgets(NOW);
    expect(payload.widgets.hydration).toBeDefined();
  });

  it("supports multi-entry timelines with future-dated entries", () => {
    registerWidget({
      kind: "daypart",
      families: ["accessoryInline"],
      render: ({ now }) => ({
        entries: [0, 1, 2].map((hours) => ({
          date: now + hours * 3_600_000,
          view: <Text>{`t+${hours}h`}</Text>,
        })),
      }),
    });
    const entries = renderWidgets(NOW).widgets.daypart.accessoryInline.entries;
    expect(entries.map((e) => e.date)).toEqual([
      NOW,
      NOW + 3_600_000,
      NOW + 7_200_000,
    ]);
    expect(entries[2].tree?.props.text).toBe("t+2h");
  });

  it("carries per-entry Smart Stack relevance into the payload", () => {
    registerWidget({
      kind: "daypart",
      families: ["accessoryInline"],
      render: ({ now }) => ({
        entries: [
          {
            date: now,
            relevance: { score: 80, durationMs: 6 * 3_600_000 },
            view: <Text>morning</Text>,
          },
          { date: now + 1, view: <Text>no relevance</Text> },
        ],
      }),
    });
    const entries = renderWidgets(NOW).widgets.daypart.accessoryInline.entries;
    expect(entries[0].relevance).toEqual({
      score: 80,
      durationMs: 21_600_000,
    });
    expect(entries[1].relevance).toBeUndefined();
  });

  it("serializes Smart Stack relevantContexts (date/location)", () => {
    registerWidget({
      kind: "geo",
      families: ["accessoryInline"],
      render: ({ now }) => ({
        entries: [{ date: now, view: <Text>x</Text> }],
        relevantContexts: [
          { latitude: 37.33, longitude: -122.03, radius: 100 },
          { date: now + 3_600_000 },
        ],
      }),
    });
    const timeline = renderWidgets(NOW).widgets.geo.accessoryInline;
    expect(timeline.relevantContexts).toEqual([
      { latitude: 37.33, longitude: -122.03, radius: 100 },
      { date: NOW + 3_600_000 },
    ]);
  });

  it("expands an instances widget into one timeline per id keyed kind/id", () => {
    registerWidget({
      kind: "shopping",
      families: ["accessoryInline"],
      instances: () => ["groceries", "hardware"],
      render: ({ now, instanceId }) => ({
        entries: [{ date: now, view: <Text>{instanceId ?? "?"}</Text> }],
      }),
    });
    const { widgets } = renderWidgets(NOW);
    expect(Object.keys(widgets).sort()).toEqual([
      "shopping/groceries",
      "shopping/hardware",
    ]);
    expect(
      widgets["shopping/groceries"].accessoryInline.entries[0].tree?.props.text,
    ).toBe("groceries");
    expect(
      widgets["shopping/hardware"].accessoryInline.entries[0].tree?.props.text,
    ).toBe("hardware");
    // No bare "shopping" key when instances are used.
    expect(widgets.shopping).toBeUndefined();
  });

  it("publishes registered control metadata for the widget extension", () => {
    registerControl({
      kind: "hydration.addGlass",
      intent: "addGlass",
      label: "Add Glass",
      systemName: "drop.fill",
    });
    expect(renderWidgets(NOW).controls).toEqual({
      "hydration.addGlass": {
        intent: "addGlass",
        label: "Add Glass",
        systemName: "drop.fill",
      },
    });
    unregisterAllWidgets();
    expect(renderWidgets(NOW).controls).toEqual({});
  });
});
