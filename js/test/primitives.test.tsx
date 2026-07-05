import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CrownRotation,
  DatePicker,
  Divider,
  FormattedText,
  Gauge,
  HStack,
  Image,
  List,
  MemoryHost,
  NavigationLink,
  NavigationRoute,
  NavigationStack,
  Picker,
  ProgressView,
  playHaptic,
  ScrollView,
  SecureField,
  type SerializedNode,
  Slider,
  Stepper,
  TabView,
  Text,
  TextField,
  TimerText,
  VStack,
  WatchRoot,
  ZStack,
} from "../src/index";
import { installMockHost } from "./helpers";

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__host;
});

function render(element: React.ReactNode): SerializedNode {
  const host = new MemoryHost();
  new WatchRoot(host).render(element);
  return host.lastCommit!.root!;
}

describe("container primitives", () => {
  it("serializes ZStack, ScrollView and List with their children", () => {
    const root = render(
      <ZStack>
        <ScrollView>
          <List>
            <Text>row 1</Text>
            <Text>row 2</Text>
          </List>
        </ScrollView>
      </ZStack>,
    );
    expect(root.type).toBe("ZStack");
    expect(root.children[0].type).toBe("ScrollView");
    const list = root.children[0].children[0];
    expect(list.type).toBe("List");
    expect(list.children.map((c) => c.props.text)).toEqual(["row 1", "row 2"]);
  });

  it("serializes Divider with no props", () => {
    const root = render(
      <VStack>
        <Divider />
      </VStack>,
    );
    expect(root.children[0]).toEqual({
      id: root.children[0].id,
      type: "Divider",
      props: {},
      children: [],
    });
  });
});

describe("data display primitives", () => {
  it("serializes Text with monospaced digits", () => {
    const root = render(<Text monospacedDigit>00:01.234</Text>);
    expect(root).toMatchObject({
      type: "Text",
      props: { text: "00:01.234", monospacedDigit: true },
    });
  });

  it("serializes Gauge with value range, label and style", () => {
    const root = render(
      <Gauge value={3} min={0} max={8} label="Water" style="circular" />,
    );
    expect(root).toMatchObject({
      type: "Gauge",
      props: { value: 3, min: 0, max: 8, label: "Water", style: "circular" },
    });
  });

  it("serializes ProgressView with value and total", () => {
    const root = render(<ProgressView value={3} total={8} label="Goal" />);
    expect(root).toMatchObject({
      type: "ProgressView",
      props: { value: 3, total: 8, label: "Goal" },
    });
  });
});

describe("Image sources", () => {
  it("serializes an SF Symbol, a remote URL, and inline base64", () => {
    const symbol = render(<Image systemName="play.fill" color="green" />);
    expect(symbol.props).toMatchObject({
      systemName: "play.fill",
      color: "green",
    });

    const remote = render(
      <Image source="https://cdn.test/poster.jpg" size={60} />,
    );
    expect(remote.props).toMatchObject({
      source: "https://cdn.test/poster.jpg",
      size: 60,
    });

    const inline = render(<Image data="iVBORw0KGgo=" />);
    expect(inline.props).toMatchObject({ data: "iVBORw0KGgo=" });
  });
});

describe("input primitives", () => {
  it("serializes TextField with onChange as an interactivity flag", () => {
    const root = render(
      <TextField value="Emin" placeholder="Name" onChange={() => {}} />,
    );
    expect(root).toMatchObject({
      type: "TextField",
      props: { value: "Emin", placeholder: "Name", onChange: true },
    });
  });

  it("serializes SecureField like TextField (distinct type, same props)", () => {
    const root = render(
      <SecureField
        value="hunter2"
        placeholder="Passcode"
        onChange={() => {}}
      />,
    );
    expect(root).toMatchObject({
      type: "SecureField",
      props: { value: "hunter2", placeholder: "Passcode", onChange: true },
    });
  });

  it("dispatches change events to a SecureField handler", () => {
    const onSecret = vi.fn();
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<SecureField onChange={onSecret} />);
    root.dispatchEvent({
      nodeId: host.lastCommit!.root!.id,
      event: "change",
      payload: { value: "s3cret" },
    });
    expect(onSecret).toHaveBeenCalledWith("s3cret");
  });

  it("serializes Picker with its options array intact", () => {
    const root = render(
      <Picker
        label="Mood"
        options={["calm", "focused", "tired"]}
        value={1}
        onChange={() => {}}
      />,
    );
    expect(root.props).toEqual({
      label: "Mood",
      options: ["calm", "focused", "tired"],
      value: 1,
      onChange: true,
    });
  });

  it("dispatches change events to TextField and Picker handlers", () => {
    const onText = vi.fn();
    const onPick = vi.fn();
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <VStack>
        <TextField onChange={onText} />
        <Picker options={["a", "b"]} onChange={onPick} />
      </VStack>,
    );
    const [field, picker] = host.lastCommit!.root!.children;
    root.dispatchEvent({
      nodeId: field.id,
      event: "change",
      payload: { value: "hello" },
    });
    root.dispatchEvent({
      nodeId: picker.id,
      event: "change",
      payload: { value: 1 },
    });
    expect(onText).toHaveBeenCalledWith("hello");
    expect(onPick).toHaveBeenCalledWith(1);
  });

  it("serializes TimerText with timestamp props and no children", () => {
    const root = render(
      <TimerText since={1000} bold size={28} color="green" />,
    );
    expect(root).toEqual({
      id: root.id,
      type: "TimerText",
      props: { since: 1000, bold: true, size: 28, color: "green" },
      children: [],
    });
  });

  it("serializes a countdown TimerText", () => {
    const root = render(<TimerText until={5000} />);
    expect(root).toMatchObject({ type: "TimerText", props: { until: 5000 } });
  });

  it("serializes TimerText milliseconds mode", () => {
    const root = render(<TimerText since={1000} milliseconds />);
    expect(root).toMatchObject({
      type: "TimerText",
      props: { since: 1000, milliseconds: true },
    });
  });

  it("serializes CrownRotation with range/step and folds onChange to a flag", () => {
    const root = render(
      <CrownRotation
        value={5}
        from={0}
        through={10}
        step={1}
        haptic
        onChange={() => {}}
      >
        <Text>5</Text>
      </CrownRotation>,
    );
    expect(root).toMatchObject({
      type: "CrownRotation",
      props: {
        value: 5,
        from: 0,
        through: 10,
        step: 1,
        haptic: true,
        onChange: true,
      },
    });
    expect(root.children[0].props.text).toBe("5");
  });

  it("dispatches Crown rotation as a change event with the new value", () => {
    const onChange = vi.fn();
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <CrownRotation value={5} onChange={onChange}>
        <Text>5</Text>
      </CrownRotation>,
    );
    const crown = host.lastCommit!.root!;
    root.dispatchEvent({
      nodeId: crown.id,
      event: "change",
      payload: { value: 7 },
    });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("serializes Slider and dispatches its change", () => {
    const onChange = vi.fn();
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <Slider
        value={0.5}
        from={0}
        through={1}
        step={0.1}
        onChange={onChange}
      />,
    );
    const slider = host.lastCommit!.root!;
    expect(slider).toMatchObject({
      type: "Slider",
      props: { value: 0.5, from: 0, through: 1, step: 0.1, onChange: true },
    });
    root.dispatchEvent({
      nodeId: slider.id,
      event: "change",
      payload: { value: 0.8 },
    });
    expect(onChange).toHaveBeenCalledWith(0.8);
  });

  it("serializes Stepper with label and range", () => {
    const root = render(
      <Stepper
        value={3}
        from={0}
        through={10}
        step={1}
        label="Count"
        onChange={() => {}}
      />,
    );
    expect(root).toMatchObject({
      type: "Stepper",
      props: {
        value: 3,
        from: 0,
        through: 10,
        step: 1,
        label: "Count",
        onChange: true,
      },
    });
  });

  it("serializes DatePicker and dispatches its change (epoch ms)", () => {
    const onChange = vi.fn();
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <DatePicker
        value={1_750_000_000_000}
        mode="date"
        label="When"
        onChange={onChange}
      />,
    );
    const picker = host.lastCommit!.root!;
    expect(picker).toMatchObject({
      type: "DatePicker",
      props: {
        value: 1_750_000_000_000,
        mode: "date",
        label: "When",
        onChange: true,
      },
    });
    root.dispatchEvent({
      nodeId: picker.id,
      event: "change",
      payload: { value: 1_750_000_100_000 },
    });
    expect(onChange).toHaveBeenCalledWith(1_750_000_100_000);
  });

  it("serializes TabView pages as children", () => {
    const root = render(
      <TabView>
        <VStack>
          <Text>page 1</Text>
        </VStack>
        <VStack>
          <Text>page 2</Text>
        </VStack>
      </TabView>,
    );
    expect(root.type).toBe("TabView");
    expect(root.children).toHaveLength(2);
    // Uncontrolled: no selection prop crosses, so native must not bind.
    expect(root.props.selection).toBeUndefined();
  });

  it("serializes FormattedText date and number modes", () => {
    const root = render(
      <VStack>
        <FormattedText date={1768483200000} timeStyle="short" />
        <FormattedText value={0.5} format="percent" maxFractionDigits={1} />
      </VStack>,
    );
    // Only the declarative target crosses the wire — native owns the
    // locale-aware rendering (i18n step 2), so there is no formatted string.
    expect(root.children[0]).toMatchObject({
      type: "FormattedText",
      props: { date: 1768483200000, timeStyle: "short" },
    });
    expect(root.children[1]).toMatchObject({
      type: "FormattedText",
      props: { value: 0.5, format: "percent", maxFractionDigits: 1 },
    });
  });

  it("routes a controlled TabView swipe through onChange like Picker", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    const seen: number[] = [];
    function App() {
      const [page, setPage] = useState(1);
      return (
        <TabView
          selection={page}
          onChange={(index) => {
            seen.push(index);
            setPage(index);
          }}
        >
          <Text>one</Text>
          <Text>two</Text>
        </TabView>
      );
    }
    root.render(<App />);
    const node = host.lastCommit!.root!;
    expect(node.props).toMatchObject({ selection: 1, onChange: true });

    // The native swipe: the same change event + {value} payload as Picker.
    root.dispatchEvent({
      nodeId: node.id,
      event: "change",
      payload: { value: 0 },
      seq: 1,
    });
    expect(seen).toEqual([0]);
    expect(host.lastCommit!.root!.props.selection).toBe(0);
  });
});

describe("haptics", () => {
  it("forwards to the host bridge when available", () => {
    const host = installMockHost();
    playHaptic("success");
    expect(host.playHaptic).toHaveBeenCalledWith("success");
  });

  it("is a no-op without a haptics-capable host", () => {
    expect(() => playHaptic()).not.toThrow();
  });
});

describe("navigation primitives", () => {
  it("serializes route-first NavigationLink and NavigationRoute nodes", () => {
    const root = render(
      <NavigationStack title="Demos" path={["/details"]}>
        <NavigationRoute path="/" title="Demos">
          <List>
            <NavigationLink to="/details" label="Details" />
            <NavigationLink to="/settings" accessibilityLabel="Settings">
              <HStack>
                <Text>Settings</Text>
              </HStack>
            </NavigationLink>
          </List>
        </NavigationRoute>
        <NavigationRoute path="/details" title="Details">
          <VStack>
            <Text>detail screen</Text>
          </VStack>
        </NavigationRoute>
      </NavigationStack>,
    );
    expect(root.type).toBe("NavigationStack");
    expect(root.props.title).toBe("Demos");
    expect(root.props.path).toEqual(["/details"]);
    const home = root.children[0];
    expect(home.type).toBe("NavigationRoute");
    expect(home.props.path).toBe("/");
    const link = home.children[0].children[0];
    expect(link.type).toBe("NavigationLink");
    expect(link.props.to).toBe("/details");
    expect(link.props.label).toBe("Details");
    const customLink = home.children[0].children[1];
    expect(customLink.props.to).toBe("/settings");
    expect(customLink.children[0].children[0].props.text).toBe("Settings");
    const details = root.children[1];
    expect(details.props.path).toBe("/details");
    expect(details.children[0].children[0].props.text).toBe("detail screen");
  });
});

describe("layout modifier props (design-system Tier 1)", () => {
  it("modifier props cross the wire verbatim", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <VStack
        alignment="leading"
        spacing={4}
        padding={{ horizontal: 8, vertical: 2 }}
        background="#112233"
        cornerRadius={12}
        frame={{ maxWidth: "infinity", height: 40 }}
        opacity={0.5}
        tint="cyan"
      >
        <Text padding={6}>hi</Text>
      </VStack>,
    );
    const node = host.lastCommit!.root!;
    expect(node.props).toMatchObject({
      alignment: "leading",
      spacing: 4,
      padding: { horizontal: 8, vertical: 2 },
      background: "#112233",
      cornerRadius: 12,
      frame: { maxWidth: "infinity", height: 40 },
      opacity: 0.5,
      tint: "cyan",
    });
    expect(node.children[0].props.padding).toBe(6);
  });
});

describe("animation prop", () => {
  it("crosses the wire verbatim", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <VStack animation={{ kind: "spring", duration: 0.3 }}>
        <Text>hi</Text>
      </VStack>,
    );
    expect(host.lastCommit!.root!.props.animation).toEqual({
      kind: "spring",
      duration: 0.3,
    });
  });
});
