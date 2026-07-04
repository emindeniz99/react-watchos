import { useCallback } from "react";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  Button,
  href,
  MemoryHost,
  matchRoute,
  NavigationProvider,
  NavigationRoute,
  NavigationStack,
  type ParamsOf,
  routeFromURL,
  runApp,
  type SerializedNode,
  Text,
  Toggle,
  unregisterAllNativeListeners,
  useFocusEffect,
  useIsFocused,
  useNavigate,
  useNavigation,
  useParams,
  useRoute,
  VStack,
} from "../src/index";
import { findByText, findByType } from "./helpers";

afterEach(() => {
  unregisterAllNativeListeners();
  delete (globalThis as Record<string, unknown>).__pushNativeEvent;
  delete (globalThis as Record<string, unknown>).__dispatchEvent;
});

function RouteProbe() {
  const route = useRoute();
  const navigate = useNavigate();
  const nav = useNavigation();
  return (
    <VStack>
      <Text>{route}</Text>
      <Button onPress={() => navigate("/hydration")}>
        <Text>go hydration</Text>
      </Button>
      <Button onPress={() => nav.goBack()}>
        <Text>back</Text>
      </Button>
    </VStack>
  );
}

function buttonByText(root: SerializedNode, text: string): SerializedNode {
  const match = findByType(root, "Button").find(
    (node) => findByText(node, text).length > 0,
  );
  if (!match) throw new Error(`missing button: ${text}`);
  return match;
}

type PushFn = (name: string, payloadJson?: string) => boolean;

describe("navigation helpers", () => {
  it("maps widget/deep-link URLs to route paths", () => {
    expect(routeFromURL("reactwatch://hydration")).toBe("/hydration");
    expect(routeFromURL("reactwatch:///stopwatch?source=widget")).toBe(
      "/stopwatch",
    );
    expect(routeFromURL("other://hydration")).toBe(null);
  });

  it("pushes, pops, and accepts native openURL events", () => {
    const host = new MemoryHost();
    const root = runApp(
      <NavigationProvider>
        <RouteProbe />
      </NavigationProvider>,
      host,
    );
    expect(findByText(host.lastCommit!.root!, "/")).toHaveLength(1);

    root.dispatchEvent({
      nodeId: buttonByText(host.lastCommit!.root!, "go hydration").id,
      event: "press",
    });
    expect(findByText(host.lastCommit!.root!, "/hydration")).toHaveLength(1);

    root.dispatchEvent({
      nodeId: buttonByText(host.lastCommit!.root!, "back").id,
      event: "press",
    });
    expect(findByText(host.lastCommit!.root!, "/")).toHaveLength(1);

    const push = (globalThis as { __pushNativeEvent?: PushFn })
      .__pushNativeEvent!;
    expect(
      push("openURL", JSON.stringify({ url: "reactwatch://stopwatch" })),
    ).toBe(true);
    expect(findByText(host.lastCommit!.root!, "/stopwatch")).toHaveLength(1);
  });

  it("normalizes initial path arrays", () => {
    const host = new MemoryHost();
    runApp(
      <NavigationProvider initialPath={["hydration"]}>
        <RouteProbe />
      </NavigationProvider>,
      host,
    );
    expect(findByText(host.lastCommit!.root!, "/hydration")).toHaveLength(1);
  });
});

describe("matchRoute", () => {
  it("matches a literal route exactly", () => {
    expect(matchRoute("/lists", "/lists")?.params).toEqual({});
    expect(matchRoute("/lists", "/list")).toBeNull();
    expect(matchRoute("/lists", "/lists/1")).toBeNull();
  });

  it("captures a single [id] segment", () => {
    expect(matchRoute("/list/[id]", "/list/42")?.params).toEqual({ id: "42" });
    // [id] is one segment, not a catch-all.
    expect(matchRoute("/list/[id]", "/list/42/items")).toBeNull();
    expect(matchRoute("/list/[id]", "/list")).toBeNull();
  });

  it("captures a required [...rest] catch-all as an array", () => {
    expect(
      matchRoute("/shop/[name]/[...rest]", "/shop/nike/a/b")?.params,
    ).toEqual({ name: "nike", rest: ["a", "b"] });
    // Required catch-all needs at least one trailing segment.
    expect(matchRoute("/shop/[name]/[...rest]", "/shop/nike")).toBeNull();
  });

  it("treats [[...rest]] as an optional catch-all", () => {
    expect(
      matchRoute("/shop/[name]/[[...rest]]", "/shop/nike")?.params,
    ).toEqual({
      name: "nike",
      rest: [],
    });
    expect(
      matchRoute("/shop/[name]/[[...rest]]", "/shop/nike/shoes/running")
        ?.params,
    ).toEqual({ name: "nike", rest: ["shoes", "running"] });
  });

  it("scores a concrete route above a catch-all that also matches", () => {
    const concrete = matchRoute("/shop/[name]", "/shop/nike");
    const optional = matchRoute("/shop/[name]/[[...rest]]", "/shop/nike");
    expect(concrete?.score).toBeGreaterThan(optional!.score);
  });
});

function ParamProbe() {
  const { id } = useParams<{ id: string }>();
  return <Text>{`id=${id ?? "none"}`}</Text>;
}

describe("useParams", () => {
  it("exposes the active route's dynamic params to descendants", () => {
    const host = new MemoryHost();
    runApp(
      <NavigationStack path={["/list/42"]}>
        <NavigationRoute path="/">
          <Text>home</Text>
        </NavigationRoute>
        <NavigationRoute path="/list/[id]">
          <ParamProbe />
        </NavigationRoute>
      </NavigationStack>,
      host,
    );
    expect(findByText(host.lastCommit!.root!, "id=42")).toHaveLength(1);
  });

  it("focuses only the best-scoring route when patterns overlap", () => {
    // The native host renders only the highest-scoring match (RouteMatcher.best),
    // so JS must focus only that one — else a losing overlapping route (here the
    // optional catch-all) fires useFocusEffect + reports useIsFocused() on a
    // screen the user never sees.
    function FocusProbe({ tag }: { tag: string }) {
      const focused = useIsFocused();
      return <Text>{`${tag}:${focused}`}</Text>;
    }
    const host = new MemoryHost();
    runApp(
      <NavigationStack path={["/shop/nike"]}>
        <NavigationRoute path="/shop/[name]">
          <FocusProbe tag="concrete" />
        </NavigationRoute>
        <NavigationRoute path="/shop/[name]/[[...rest]]">
          <FocusProbe tag="catchall" />
        </NavigationRoute>
      </NavigationStack>,
      host,
    );
    const root = host.lastCommit!.root!;
    expect(findByText(root, "concrete:true")).toHaveLength(1); // score 3 wins
    expect(findByText(root, "catchall:false")).toHaveLength(1); // score 2 loses
  });
});

describe("uncontrolled NavigationStack", () => {
  it("tracks the native path so params and focus follow pushed screens", () => {
    // No `path` prop: the native stack drives itself (NavigationLink pushes,
    // swipe-back) and reports each change via pathChange. JS must fold that in,
    // or `active` stays pinned at "/" and useParams()/useIsFocused() are wrong
    // on every pushed screen — the whole point of the fix.
    function ListProbe() {
      const { id } = useParams<{ id: string }>();
      const focused = useIsFocused();
      return <Text>{`list:${id ?? "none"}:${focused}`}</Text>;
    }
    const host = new MemoryHost();
    const root = runApp(
      <NavigationStack>
        <NavigationRoute path="/">
          <Text>home</Text>
        </NavigationRoute>
        <NavigationRoute path="/list/[id]">
          <ListProbe />
        </NavigationRoute>
      </NavigationStack>,
      host,
    );
    // Before any native push the stack is at root; /list is neither focused nor
    // carrying params.
    expect(findByText(host.lastCommit!.root!, "list:none:false")).toHaveLength(
      1,
    );

    // Native pushes /list/42 and reports it through pathChange.
    const stack = findByType(host.lastCommit!.root!, "NavigationStack")[0];
    root.dispatchEvent({
      nodeId: stack.id,
      event: "pathChange",
      payload: { path: ["/list/42"] },
    });
    expect(findByText(host.lastCommit!.root!, "list:42:true")).toHaveLength(1);
  });

  it("still forwards pathChange to a user onPathChange handler", () => {
    // Observing-but-not-controlling (onPathChange without path) must both update
    // local tracking AND fire the user handler.
    const seen: string[][] = [];
    const host = new MemoryHost();
    const root = runApp(
      <NavigationStack onPathChange={(p) => seen.push(p)}>
        <NavigationRoute path="/">
          <Text>home</Text>
        </NavigationRoute>
      </NavigationStack>,
      host,
    );
    const stack = findByType(host.lastCommit!.root!, "NavigationStack")[0];
    root.dispatchEvent({
      nodeId: stack.id,
      event: "pathChange",
      payload: { path: ["/x"] },
    });
    expect(seen).toEqual([["/x"]]);
  });
});

describe("NavigationRoute eager mounting", () => {
  // Pins the contract that every route serializes its screen even while
  // inactive. It is tempting to mount lazily (so a screen's launch effects
  // wait for first open), but the native push is controlled and optimistic:
  // RoutedNavigationStack pushes on `pendingPath` and runs its
  // navigationDestination closure — reading the route's children out of the
  // *current* tree — a bridge hop before JS commits the new active route. An
  // inactive route therefore must already carry its subtree, or the push
  // would render blank until the JS ack. If this test ever flips to lazy
  // mounting, that's a native-visible behavior change and needs on-device
  // validation, not a silent JS edit (see navigation.tsx NavigationRoute).
  it("serializes inactive route children, not just the active route", () => {
    const host = new MemoryHost();
    runApp(
      <NavigationStack path={[]}>
        <NavigationRoute path="/">
          <VStack>
            <Text>home</Text>
          </VStack>
        </NavigationRoute>
        <NavigationRoute path="/details">
          <Toggle label="detail-toggle" />
        </NavigationRoute>
      </NavigationStack>,
      host,
    );
    const root = host.lastCommit!.root!;
    // Root is active; its screen renders.
    expect(findByText(root, "home")).toHaveLength(1);
    // /details is inactive, yet its host node is present in the tree so the
    // native push has a destination to render the instant the path changes.
    expect(findByType(root, "Toggle")).toHaveLength(1);
  });
});

describe("useFocusEffect", () => {
  it("runs on focus and cleans up on blur and re-focus", () => {
    const log: string[] = [];
    function FxProbe() {
      useFocusEffect(
        useCallback(() => {
          log.push("focus");
          return () => {
            log.push("blur");
          };
        }, []),
      );
      return <Text>fx</Text>;
    }
    const tree = (path: string[]) => (
      <NavigationStack path={path} onPathChange={() => {}}>
        <NavigationRoute path="/fx">
          <FxProbe />
        </NavigationRoute>
        <NavigationRoute path="/other">
          <Text>other</Text>
        </NavigationRoute>
      </NavigationStack>
    );
    const host = new MemoryHost();
    const root = runApp(tree(["/fx"]), host);
    // Mounted AND focused → the effect runs once.
    expect(log).toEqual(["focus"]);
    // Navigate away: still mounted, now blurred → cleanup runs, effect doesn't.
    root.render(tree(["/other"]));
    expect(log).toEqual(["focus", "blur"]);
    // Returning re-focuses and runs the effect again.
    root.render(tree(["/fx"]));
    expect(log).toEqual(["focus", "blur", "focus"]);
  });
});

describe("typed routes", () => {
  it("infers params from a route template, matching the matcher grammar", () => {
    expectTypeOf<ParamsOf<"/list/[id]">>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<ParamsOf<"/shop/[name]/[...rest]">>().toEqualTypeOf<{
      name: string;
      rest: string[];
    }>();
    // Optional catch-all is ALWAYS an array ([] when absent), never undefined —
    // matching our matchRoute, not Next.js's optional semantics.
    expectTypeOf<ParamsOf<"/docs/[[...page_id]]">>().toEqualTypeOf<{
      page_id: string[];
    }>();
    // A literal-only route has no params.
    expectTypeOf<keyof ParamsOf<"/about">>().toEqualTypeOf<never>();
  });

  it("href builds a concrete path from a template and checked params", () => {
    expect(href("/list/[id]", { id: "42" })).toBe("/list/42");
    expect(
      href("/shop/[name]/[...rest]", { name: "nike", rest: ["a", "b"] }),
    ).toBe("/shop/nike/a/b");
    // Optional catch-all with no segments collapses to the base path.
    expect(href("/docs/[[...page_id]]", { page_id: [] })).toBe("/docs");
    expect(href("/docs/[[...page_id]]", { page_id: ["intro"] })).toBe(
      "/docs/intro",
    );
  });

  it("href round-trips through matchRoute", () => {
    const path = href("/list/[id]", { id: "42" });
    expect(matchRoute("/list/[id]", path)?.params).toEqual({ id: "42" });
  });

  it("percent-encodes params so '/' and '%' can't break segment structure", () => {
    // An id like "a/b" used to silently become TWO segments and never match
    // [id]; a "%" produced an invalid escape downstream. href encodes, the
    // matchers decode — values round-trip exactly.
    const path = href("/list/[id]", { id: "a/b 100%" });
    expect(path).toBe("/list/a%2Fb%20100%25");
    expect(matchRoute("/list/[id]", path)?.params).toEqual({ id: "a/b 100%" });
    // Catch-all elements encode per element and decode back as an array.
    const rest = href("/shop/[name]/[...rest]", {
      name: "café",
      rest: ["a/b", "c"],
    });
    expect(matchRoute("/shop/[name]/[...rest]", rest)?.params).toEqual({
      name: "café",
      rest: ["a/b", "c"],
    });
  });

  it("matches non-ASCII LITERAL segments arriving percent-encoded", () => {
    // Patterns are authored raw ("/café") but a valid deep link (widgetURL,
    // Swift URL) must carry the segment encoded — a raw-only compare made
    // such literals unreachable from a URL. Raw still matches too.
    expect(matchRoute("/café/[id]", "/caf%C3%A9/7")?.params).toEqual({
      id: "7",
    });
    expect(matchRoute("/café/[id]", "/café/7")?.params).toEqual({ id: "7" });
    expect(matchRoute("/café/[id]", "/tea/7")).toBeNull();
  });

  it("a malformed percent-escape falls back to the raw segment, not a throw", () => {
    // A crafted deep link like reactwatch://list/%zz must not throw out of
    // the matcher (decodeURIComponent would).
    expect(matchRoute("/list/[id]", "/list/%zz")?.params).toEqual({
      id: "%zz",
    });
  });

  it("routeFromURL keeps the path percent-encoded for the matchers", () => {
    // Decoding the whole URL up front let an encoded "/" change the segment
    // structure before matching (and threw on malformed escapes).
    expect(routeFromURL("reactwatch://list/a%2Fb")).toBe("/list/a%2Fb");
    expect(routeFromURL("reactwatch://list/%zz")).toBe("/list/%zz"); // no throw
  });
});
