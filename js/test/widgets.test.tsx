import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Gauge,
  publishWidgets,
  registerControl,
  registerWidget,
  renderToTree,
  renderWidgets,
  Storage,
  Text,
  unregisterAllWidgets,
  VStack,
} from "../src/index";
import { installMockHost } from "./helpers";

afterEach(() => {
  unregisterAllWidgets();
  delete (globalThis as Record<string, unknown>).__host;
  delete (globalThis as Record<string, unknown>).__bundleReleaseId;
  Storage.clearMemoryFallback();
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

  // The wire contract for the tagged union: each arm flattens to `kind` plus
  // ONLY its own fields. A leaked field from another arm would be read by the
  // Swift switch's other case and silently mis-surface the widget.
  it("serializes every Smart Stack clue family with only its own fields", () => {
    registerWidget({
      kind: "geo",
      families: ["accessoryInline"],
      render: ({ now }) => ({
        entries: [{ date: now, view: <Text>x</Text> }],
        relevantContexts: [
          {
            kind: "location",
            latitude: 37.33,
            longitude: -122.03,
            radius: 100,
          },
          { kind: "date", date: now + 3_600_000 },
          { kind: "date", date: new Date(now + 60_000), dateKind: "scheduled" },
          {
            kind: "dateRange",
            from: now,
            to: now + 7_200_000,
            dateKind: "informational",
          },
          { kind: "poi", category: "cafe" },
          { kind: "inferredLocation", place: "work" },
          { kind: "fitness", condition: "workoutActive" },
          { kind: "sleep", condition: "bedtime" },
          { kind: "headphones", condition: "connected" },
        ],
      }),
    });
    const timeline = renderWidgets(NOW).widgets.geo.accessoryInline;
    expect(timeline.relevantContexts).toEqual([
      { kind: "location", latitude: 37.33, longitude: -122.03, radius: 100 },
      { kind: "date", date: NOW + 3_600_000 },
      { kind: "date", date: NOW + 60_000, dateKind: "scheduled" },
      {
        kind: "dateRange",
        from: NOW,
        to: NOW + 7_200_000,
        dateKind: "informational",
      },
      { kind: "poi", category: "cafe" },
      { kind: "inferredLocation", place: "work" },
      { kind: "fitness", condition: "workoutActive" },
      { kind: "sleep", condition: "bedtime" },
      { kind: "headphones", condition: "connected" },
    ]);
  });

  // `radius`/`dateKind` are the only optional payload fields; omitting them
  // must leave the key OFF the wire, not send `undefined` — Swift decodes a
  // missing key as nil and applies its own default (100 m / the kind-less
  // watchOS 10.0 overload), which is a different thing from "author said 0".
  it("omits absent optional clue fields entirely", () => {
    registerWidget({
      kind: "geo",
      families: ["accessoryInline"],
      render: ({ now }) => ({
        entries: [{ date: now, view: <Text>x</Text> }],
        relevantContexts: [
          { kind: "location", latitude: 1, longitude: 2 },
          { kind: "date", date: now },
        ],
      }),
    });
    const contexts = renderWidgets(NOW).widgets.geo.accessoryInline
      .relevantContexts as object[];
    expect(Object.keys(contexts[0])).toEqual(["kind", "latitude", "longitude"]);
    expect(Object.keys(contexts[1])).toEqual(["kind", "date"]);
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

// ARCH-06: a payload must carry proof of WHICH state and WHICH bundle produced
// it, so a consumer can tell "old but still valid" from "describes state that
// has since moved". Timestamps alone can't: a mutation can land inside the
// freshness window and the payload still looks recent.
describe("payload provenance stamps (ARCH-06)", () => {
  const NOW = 1_750_000_000_000;

  function registerCounterWidget(onRender?: () => void) {
    registerWidget({
      kind: "hydration",
      families: ["accessoryInline"],
      render: ({ now }) => {
        onRender?.();
        return { entries: [{ date: now, view: <Text>x</Text> }] };
      },
    });
  }

  it("stamps the live state revision and the producing release id", () => {
    const host = installMockHost();
    (globalThis as Record<string, unknown>).__bundleReleaseId = "rel-abc";
    registerCounterWidget();

    Storage.set("glasses", 1); // first write of the batch -> revision 1

    const payload = renderWidgets(NOW);
    expect(payload.stateRevision).toBe(host.stateRevision());
    expect(payload.stateRevision).toBe(1);
    expect(payload.releaseId).toBe("rel-abc");
  });

  it("omits releaseId when the producing release is unknown", () => {
    installMockHost();
    registerCounterWidget();
    // No __bundleReleaseId: a runtime that booted precompiled bytecode with no
    // source to hash. "Unknown" must be absent, not a fabricated id — a
    // consumer treats nil as "can't judge the release", never as a mismatch.
    expect(renderWidgets(NOW).releaseId).toBeUndefined();
  });

  it("samples the revision ONCE, at render start, not after render()", () => {
    const host = installMockHost();
    // A render() callback that writes Storage is the whole reason the sampling
    // point matters: the tree it produced was computed from the PRE-write
    // state. Sampling after the render would stamp the post-write revision and
    // certify data the payload doesn't actually contain. Stamping the
    // pre-render revision makes the payload read STALE and forces a recompute.
    registerCounterWidget(() => Storage.set("glasses", 2));

    const payload = renderWidgets(NOW);

    // One sample per render, taken before the first render() ran.
    expect(host.stateRevision.mock.calls.length).toBe(1);
    expect(payload.stateRevision).toBe(0);
    expect(host.stateRevision()).toBe(1);
  });

  it("stamps every family of every widget from the same sample", () => {
    installMockHost();
    let writes = 0;
    registerWidget({
      kind: "multi",
      families: ["accessoryCircular", "accessoryInline"],
      render: ({ now }) => {
        writes += 1;
        Storage.set("k", writes);
        return { entries: [{ date: now, view: <Text>x</Text> }] };
      },
    });
    // One payload = one revision, so a mid-render write can't leave half the
    // families certified against a different state than the other half.
    expect(renderWidgets(NOW).stateRevision).toBe(0);
  });

  it("detects a mid-render write even when a batch was already open", () => {
    const host = installMockHost();
    // The other direction of the same guarantee, and the one the batching rule
    // used to get wrong: sampling early only makes the payload read stale if
    // the SAMPLE closes the mutation batch. Keyed to publications instead, a
    // write landing inside a batch some earlier write had already opened bumps
    // nothing — the payload gets stamped equal to the live revision and reads
    // `.current` over families computed before the write.
    Storage.set("before-render", 1); // opens the batch, revision 0 -> 1
    registerCounterWidget(() => Storage.set("during-render", 2));

    const payload = renderWidgets(NOW);

    expect(payload.stateRevision).toBe(1);
    expect(host.stateRevision()).toBe(2);
    expect(payload.stateRevision).toBeLessThan(host.stateRevision());
  });

  it("a throwing stateRevision does not wedge the recursion guard", () => {
    const host = installMockHost();
    registerCounterWidget();
    // The sample must happen BEFORE `renderingWidgets` is raised. Sampling
    // after it, outside the try, means a throwing host skips the `finally` and
    // leaves the guard set for the life of the process: every later
    // publishWidgets() then returns an empty payload, never calls the host, and
    // logs "called inside a widget render" — naming the wrong cause.
    host.stateRevision.mockImplementationOnce(() => {
      throw new Error("bridge exploded");
    });
    expect(() => renderWidgets(NOW)).toThrow("bridge exploded");

    const payload = publishWidgets(NOW);

    expect(host.publishWidgets).toHaveBeenCalledTimes(1);
    expect(Object.keys(payload.widgets)).toEqual(["hydration"]);
  });

  it("__republishWidgets publishes a payload stamped with the live revision", () => {
    const host = installMockHost();
    registerCounterWidget();
    Storage.set("glasses", 3);

    (globalThis as { __republishWidgets?: () => void }).__republishWidgets?.();

    expect(host.publishWidgets).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(host.publishWidgets.mock.calls[0][0]);
    expect(sent.stateRevision).toBe(host.stateRevision());
  });

  it("a crash between mutation and publication leaves a detectable mismatch", () => {
    const host = installMockHost();
    registerCounterWidget();
    // Steady state: the store holds a payload derived from the live revision.
    const stored = publishWidgets(NOW);
    expect(stored.stateRevision).toBe(host.stateRevision());

    // The mutation commits; the publication that should have followed dies
    // with the process (ARCH-06's "test crash between mutation and
    // publication"). Because the revision is bumped BEFORE the write, the
    // survivor is a revision AHEAD of the stored payload — fail-stale.
    Storage.set("glasses", 4);
    host.publishWidgets.mockImplementationOnce(() => {
      throw new Error("process killed before the payload reached the store");
    });
    expect(() => publishWidgets(NOW + 1)).toThrow();

    expect(stored.stateRevision).toBeLessThan(host.stateRevision());
    // ...and reconciliation is exactly "republish": the next successful
    // publication re-stamps the payload at the live revision.
    expect(publishWidgets(NOW + 2).stateRevision).toBe(host.stateRevision());
  });
});
