import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Gauge,
  Text,
  VStack,
  publishWidgets,
  registerWidget,
  renderToTree,
  renderWidgets,
  unregisterAllWidgets,
} from "../src/index";

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
  });

  it("normalizes Date entries and reloadAfter to epoch milliseconds", () => {
    registerHydration(1);
    const timeline = renderWidgets(NOW).widgets.hydration.accessoryInline;
    expect(timeline.entries[0].date).toBe(NOW);
    expect(timeline.reloadAfter).toBe(NOW + 3_600_000);
  });

  it("re-registering a kind replaces its definition", () => {
    registerHydration(1);
    registerHydration(5);
    const tree = renderWidgets(NOW).widgets.hydration.accessoryCircular
      .entries[0].tree;
    expect(tree?.props.value).toBe(5);
  });

  it("publishWidgets hands the JSON payload to the native host", () => {
    registerHydration(4);
    const published = vi.fn();
    (globalThis as Record<string, unknown>).__host = {
      commit: vi.fn(),
      log: vi.fn(),
      setTimer: vi.fn(),
      publishWidgets: published,
    };

    const payload = publishWidgets(NOW);

    expect(published).toHaveBeenCalledTimes(1);
    expect(JSON.parse(published.mock.calls[0][0])).toEqual(
      JSON.parse(JSON.stringify(payload)),
    );
  });

  it("publishWidgets still renders when the host lacks widget support", () => {
    registerHydration(2);
    const payload = publishWidgets(NOW);
    expect(payload.widgets.hydration).toBeDefined();
  });
});
