import {
  Component,
  createContext,
  forwardRef,
  lazy,
  memo,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { describe, expect, it, vi } from "vitest";
import type { SerializedNode } from "../src/host";
import { MemoryHost } from "../src/host";
import {
  Button,
  createTheme,
  ErrorBoundary,
  Gauge,
  HStack,
  Image,
  ProgressView,
  renderToTree,
  Text,
  ThemeProvider,
  useTheme,
  VStack,
  WatchRoot,
  ZStack,
} from "../src/index";
import { WatchRoot as Fiber } from "../src/renderer";

/**
 * THE drift guard for the reconciler-free widget renderer (staticRender.ts).
 *
 * The widget bundle no longer contains react-reconciler, so the walker is the
 * only thing producing widget wire payloads — and nothing else would notice if
 * it started producing a *different* tree (a shifted node `id`, an unfolded
 * <Text>, a dropped Fragment child) than the fiber path that used to. Every
 * case below is rendered through BOTH paths and compared byte-for-byte on the
 * serialized output. The fiber path is still linked in the app bundle (runApp)
 * and in this test environment, so the comparison stays honest.
 */
function viaFiber(element: ReactNode): SerializedNode | null {
  const host = new MemoryHost();
  const root = new Fiber(host);
  try {
    root.render(element);
    return host.lastCommit?.root ?? null;
  } finally {
    root.unmount();
  }
}

/** Renders through both paths and asserts they agree; returns the tree. */
function expectParity(element: ReactNode): SerializedNode | null {
  const walked = renderToTree(element);
  const fibered = viaFiber(element);
  expect(JSON.stringify(walked)).toBe(JSON.stringify(fibered));
  return walked;
}

const NumberContext = createContext("default");

function Greeting({ name }: { name: string }) {
  return <Text bold>{`Hello ${name}`}</Text>;
}

const MemoGreeting = memo(Greeting);

const ForwardedRow = forwardRef<unknown, { label: string }>((props, _ref) => (
  <HStack spacing={4}>
    <Image systemName="drop.fill" color="cyan" />
    <Text>{props.label}</Text>
  </HStack>
));

function HookedCard({ base }: { base: number }) {
  const [count] = useState(base);
  const [doubled] = useReducer((s: number) => s, base * 2);
  const label = useMemo(() => `${count}/${doubled}`, [count, doubled]);
  const onPress = useCallback(() => {}, []);
  const seen = useRef(base);
  const external = useSyncExternalStore(
    () => () => {},
    () => "live",
  );
  return (
    <VStack spacing={2}>
      <Text>{label}</Text>
      <Text>{external}</Text>
      <Button onPress={onPress}>
        <Text>{`${seen.current}`}</Text>
      </Button>
    </VStack>
  );
}

function ContextReader() {
  return <Text>{useContext(NumberContext)}</Text>;
}

class ClassCard extends Component<{ title: string }> {
  override render(): ReactNode {
    return (
      <VStack spacing={1}>
        <Text bold>{this.props.title}</Text>
      </VStack>
    );
  }
}

function ThemedCard() {
  const theme = useTheme();
  return (
    <VStack spacing={theme.space.sm} background={theme.colors.surface}>
      <Text {...theme.text.title}>Themed</Text>
    </VStack>
  );
}

describe("static widget render matches the fiber path", () => {
  it("nests host elements with the same post-order node ids", () => {
    const tree = expectParity(
      <VStack spacing={2}>
        <HStack spacing={4}>
          <Image systemName="drop.fill" color="cyan" />
          <Text bold>Hydration</Text>
        </HStack>
        <ProgressView value={3} total={8} />
        <ZStack>
          <Gauge value={3} min={0} max={8} label="Water" style="circular" />
        </ZStack>
      </VStack>,
    );
    // Spelled out, because the ids are ON THE WIRE: react-reconciler numbers
    // host instances in completeWork (post-order), and the walker must too.
    expect(tree?.id).toBe(7);
    expect(tree?.children.map((c) => c.id)).toEqual([3, 4, 6]);
  });

  it("folds scalar <Text> children and keeps rich-text segments", () => {
    expectParity(<Text bold>hello</Text>);
    expectParity(<Text>{42}</Text>);
    expectParity(<Text>{["a", "b", 3]}</Text>);
    expectParity(<Text>{false}</Text>);
    expectParity(<Text>{null}</Text>);
    const rich = expectParity(
      <Text bold>
        {"a"}
        <Text color="#FF8000">segment</Text>
        {""}
        {"c"}
      </Text>,
    );
    // The empty string produces no node in React, so it produces none here.
    expect(rich?.children.map((c) => c.props.text)).toEqual([
      "a",
      "segment",
      "c",
    ]);
    expect(rich?.props.text).toBe("");
  });

  it("flattens fragments, arrays, keys and conditional children", () => {
    const items = ["one", "two"];
    expectParity(
      <VStack>
        {/* biome-ignore lint/complexity/noUselessFragments: the point is that
            a Fragment adds depth but no node, in both render paths. */}
        <>
          <Text>frag</Text>
          {items.map((item) => (
            <Text key={item}>{item}</Text>
          ))}
        </>
        {null}
        {undefined}
        {false}
        {items.length > 0 && <Text>some</Text>}
        {[[<Text key="deep">deep</Text>]]}
      </VStack>,
    );
  });

  it("renders function, memo, forwardRef and class components", () => {
    expectParity(
      <VStack>
        <Greeting name="Emin" />
        <MemoGreeting name="memo" />
        <ForwardedRow label="fwd" />
        <ClassCard title="class" />
        <ErrorBoundary fallback={<Text>boom</Text>}>
          <Text>guarded</Text>
        </ErrorBoundary>
      </VStack>,
    );
  });

  it("resolves context providers, consumers and defaults", () => {
    expectParity(
      <VStack>
        <ContextReader />
        <NumberContext.Provider value="outer">
          <ContextReader />
          <NumberContext.Provider value="inner">
            <ContextReader />
          </NumberContext.Provider>
          <NumberContext.Consumer>
            {(value) => <Text>{value}</Text>}
          </NumberContext.Consumer>
        </NumberContext.Provider>
        {/* Back outside the provider: the stack must have popped. */}
        <ContextReader />
      </VStack>,
    );
  });

  it("supports the deterministic hook subset", () => {
    expectParity(<HookedCard base={4} />);
  });

  // The build preset runs the React Compiler over consumer source, so ANY
  // component in a widget tree is compiled to a `c(n)` memo-cache call — a
  // direct hit on the dispatcher slot. Without `useMemoCache` a compiled widget
  // component would throw on its first line, and the demo widgets (all inline
  // JSX) would never have caught it. This is what the compiler emits.
  it("serves the React Compiler's memo cache", async () => {
    // @types/react deliberately omits this module's exports ("not meant to be
    // used directly") — the compiler emits the call, humans don't write it.
    const { c } = (await import("react/compiler-runtime")) as unknown as {
      c: (size: number) => unknown[];
    };
    function Compiled({ base }: { base: number }) {
      const $ = c(2);
      let text: string;
      if ($[0] !== base) {
        text = `compiled ${base}`;
        $[0] = base;
        $[1] = text;
      } else {
        text = $[1] as string;
      }
      return <Text>{text}</Text>;
    }
    const tree = expectParity(<Compiled base={7} />);
    expect(tree?.props.text).toBe("compiled 7");
  });

  it("resolves the library's own context layers (theme)", () => {
    expectParity(
      <ThemeProvider theme={createTheme({ colors: { surface: "#101010" } })}>
        <ThemedCard />
      </ThemeProvider>,
    );
  });

  it("agrees on the multi-root failure", () => {
    const twoRoots = (
      <>
        <Text>a</Text>
        <Text>b</Text>
      </>
    );
    expect(() => renderToTree(twoRoots)).toThrow(/single root element/);
    expect(() => viaFiber(twoRoots)).toThrow(/single root element/);
  });

  it("agrees that raw text needs a <Text> wrapper", () => {
    const bare = <VStack>plain</VStack>;
    expect(() => renderToTree(bare)).toThrow(/Raw text must be wrapped/);
    expect(() => viaFiber(bare)).toThrow(/Raw text must be wrapped/);
    expect(() => renderToTree("top level")).toThrow(/Raw text must be wrapped/);
  });

  it("returns null for nothing to render", () => {
    for (const empty of [null, undefined, false, "", []]) {
      expect(renderToTree(empty as ReactNode)).toBeNull();
    }
  });
});

describe("static widget render is one-shot and pure", () => {
  it("never runs effects — where the fiber path would", () => {
    const effect = vi.fn();
    function Effectful() {
      useEffect(() => {
        effect();
      }, []);
      return <Text>effectful</Text>;
    }
    // Same serialized tree either way; the difference is entirely in what runs
    // AFTER the render, which is the rule widget authors have to know.
    expectParity(<Effectful />);
    expect(effect).toHaveBeenCalledTimes(1); // the fiber half of expectParity
    effect.mockClear();
    renderToTree(<Effectful />);
    expect(effect).not.toHaveBeenCalled();
  });

  it("throws a pointed error when a component updates state during render", () => {
    function Rogue() {
      const [value, setValue] = useState(0);
      setValue(value + 1);
      return <Text>{value}</Text>;
    }
    expect(() => renderToTree(<Rogue />)).toThrow(/pure function of its props/);
  });

  it("gives useId a stable value without a fiber", () => {
    function Ided() {
      return <Text accessibilityLabel={useId()}>id</Text>;
    }
    const first = renderToTree(<Ided />);
    const second = renderToTree(<Ided />);
    expect(first?.props.accessibilityLabel).toBe(
      second?.props.accessibilityLabel,
    );
  });
});

describe("static widget render rejects what it cannot honour", () => {
  it("names Suspense", () => {
    expect(() =>
      renderToTree(
        <Suspense fallback={<Text>…</Text>}>
          <Text>late</Text>
        </Suspense>,
      ),
    ).toThrow(/react.suspense.* is not supported in a widget render/s);
  });

  it("names lazy()", () => {
    const Late = lazy(async () => ({ default: () => <Text>late</Text> }));
    expect(() => renderToTree(<Late />)).toThrow(
      /react\.lazy.* is not supported in a widget render/s,
    );
  });

  it("rejects a plain object child", () => {
    expect(() =>
      renderToTree(<VStack>{{ nope: true } as unknown as ReactNode}</VStack>),
    ).toThrow(/Objects are not valid as a React child/);
  });

  it("requires a function child on a Consumer", () => {
    expect(() =>
      renderToTree(
        <NumberContext.Consumer>
          {"not a function" as unknown as (value: string) => ReactNode}
        </NumberContext.Consumer>,
      ),
    ).toThrow(/needs a function as its child/);
  });

  it("points at the widget rule in docs", () => {
    let message = "";
    try {
      renderToTree(
        <Suspense fallback={null}>
          <Text>x</Text>
        </Suspense>,
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("docs/ui-guide.md");
  });
});

describe("the app path is untouched", () => {
  it("still mounts through the reconciler", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Text>app</Text>);
    expect(host.lastCommit?.root?.props.text).toBe("app");
    root.dispose();
  });
});
