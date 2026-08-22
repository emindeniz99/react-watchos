import { type ReactNode, useCallback, useState } from "react";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  Button,
  deepLinkURL,
  getURLScheme,
  href,
  MemoryHost,
  matchRoute,
  NavigationProvider,
  NavigationRoute,
  NavigationStack,
  type ParamsOf,
  routeFromURL,
  type SerializedNode,
  Text,
  Toggle,
  useFocusEffect,
  useIsFocused,
  useNavigate,
  useNavigation,
  useParams,
  useRoute,
  VStack,
} from "../src/index";
import { findByText, findByType, mountApp, resetApp } from "./helpers";

afterEach(resetApp);

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

  it("defaults the scheme to the host-injected value, else 'reactwatch'", () => {
    // No host global (Node/tests) -> the built-in fallback.
    expect(getURLScheme()).toBe("reactwatch");
    expect(deepLinkURL("/hydration")).toBe("reactwatch://hydration");

    // A real build injects globalThis.__urlScheme (the app's registered scheme);
    // both building and parsing then follow it with no second place to set it.
    (globalThis as Record<string, unknown>).__urlScheme = "com.acme.myapp";
    expect(getURLScheme()).toBe("com.acme.myapp");
    expect(deepLinkURL("/list/42")).toBe("com.acme.myapp://list/42");
    expect(deepLinkURL("/")).toBe("com.acme.myapp://");
    // routeFromURL parses the host scheme, and rejects the stale literal.
    expect(routeFromURL("com.acme.myapp://stopwatch")).toBe("/stopwatch");
    expect(routeFromURL("reactwatch://stopwatch")).toBe(null);
  });

  it("round-trips deepLinkURL through routeFromURL", () => {
    (globalThis as Record<string, unknown>).__urlScheme = "com.acme.myapp";
    expect(routeFromURL(deepLinkURL("/shop/beans"))).toBe("/shop/beans");
  });

  it("pushes, pops, and accepts native openURL events", () => {
    const host = new MemoryHost();
    const root = mountApp(
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
    mountApp(
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
    mountApp(
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

  it("keeps a covered route's params — its subtree is still in native's tree", () => {
    // The tree-diff measurement pass caught this: a covered screen stays
    // mounted (ARCH-09) and native still HOLDS its serialized subtree, but
    // params used to be extracted only against the TOP of the stack — so
    // /list/[id] under a pushed settings screen matched nothing and rendered
    // its no-param branch into the tree the user returns to on pop.
    function ListProbe() {
      const { id } = useParams<{ id: string }>();
      const focused = useIsFocused();
      return <Text>{id ? `list:${id}:${focused}` : "list-not-found"}</Text>;
    }
    const host = new MemoryHost();
    mountApp(
      <NavigationStack path={["/list/7", "/settings"]}>
        <NavigationRoute path="/">
          <Text>home</Text>
        </NavigationRoute>
        <NavigationRoute path="/list/[id]">
          <ListProbe />
        </NavigationRoute>
        <NavigationRoute path="/settings">
          <Text>settings</Text>
        </NavigationRoute>
      </NavigationStack>,
      host,
    );
    const root = host.lastCommit!.root!;
    // Covered, unfocused — but with ITS entry's params, not the top's.
    expect(findByText(root, "list:7:false")).toHaveLength(1);
    expect(findByText(root, "list-not-found")).toHaveLength(0);
    expect(findByText(root, "settings")).toHaveLength(1);
  });

  it("focuses and mounts only the best-scoring route when patterns overlap", () => {
    // The native host renders only the highest-scoring match (RouteMatcher.best),
    // so JS must mount and focus only that one — else a losing overlapping route
    // (here the optional catch-all) would serialize, fire useFocusEffect, and
    // report useIsFocused() for a screen the user never sees.
    function FocusProbe({ tag }: { tag: string }) {
      const focused = useIsFocused();
      return <Text>{`${tag}:${focused}`}</Text>;
    }
    const host = new MemoryHost();
    mountApp(
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
    // The loser isn't merely unfocused — it doesn't mount at all (ARCH-09).
    expect(findByText(root, "catchall:false")).toHaveLength(0); // score 2 loses
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
    const root = mountApp(
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
    // Before any native push the stack is at root; /list isn't mounted (lazy),
    // so its probe can't render at all.
    expect(findByText(host.lastCommit!.root!, "home")).toHaveLength(1);
    expect(findByType(host.lastCommit!.root!, "Text")).toHaveLength(1);

    // Native pushes /list/42 and reports it through pathChange; folding it
    // into localPath mounts, focuses, and parameterizes the screen within the
    // same dispatch.
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
    const root = mountApp(
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

describe("NavigationRoute lazy mounting (ARCH-09)", () => {
  // Pins the flipped contract: only the root and the active stack's winners
  // serialize a subtree. This is safe — no blank push — because navigation is
  // now a confirmed transaction, not an optimistic native push: the
  // `pathChange` dispatch folds the path, the CX-010 forced flush commits the
  // newly mounted destination synchronously, and native animates only after
  // the returned `accepted` verdict. Flipping back to eager mounting would
  // resurrect launch-time effects on every inactive screen.

  /** A controlled stack whose handler FOLDS (accepts) every proposal. */
  function FoldingStack({ children }: { children?: ReactNode }) {
    const [path, setPath] = useState<string[]>([]);
    return (
      <NavigationStack path={path} onPathChange={setPath}>
        {children}
      </NavigationStack>
    );
  }

  const routes = (
    <>
      <NavigationRoute path="/">
        <VStack>
          <Text>home</Text>
        </VStack>
      </NavigationRoute>
      <NavigationRoute path="/details">
        <Toggle label="detail-toggle" />
      </NavigationRoute>
    </>
  );

  it("serializes no inactive subtree at launch; a confirmed push mounts it in the same dispatch", () => {
    const host = new MemoryHost();
    const root = mountApp(<FoldingStack>{routes}</FoldingStack>, host);
    const before = host.lastCommit!.root!;
    // Root is active; its screen renders.
    expect(findByText(before, "home")).toHaveLength(1);
    // /details is inactive: its route node stays (path/title for the native
    // resolver) but carries NO children — its effects can't run at launch.
    expect(findByType(before, "NavigationRoute")).toHaveLength(2);
    expect(findByType(before, "Toggle")).toHaveLength(0);

    const result = root.dispatchEvent({
      nodeId: findByType(before, "NavigationStack")[0].id,
      event: "pathChange",
      payload: { path: ["/details"] },
      seq: 4,
    });
    expect(result).toEqual({ handled: true, accepted: true });
    // The confirming commit — produced INSIDE the dispatch — already carries
    // the pushed subtree and acks the seq, so native animates into content.
    expect(findByType(host.lastCommit!.root!, "Toggle")).toHaveLength(1);
    expect(host.lastCommit!.seq).toBe(4);
  });

  it("declines a proposal the controlled handler ignores and leaves the tree unchanged", () => {
    const host = new MemoryHost();
    const root = mountApp(
      <NavigationStack path={[]} onPathChange={() => {}}>
        {routes}
      </NavigationStack>,
      host,
    );
    const stack = findByType(host.lastCommit!.root!, "NavigationStack")[0];
    const result = root.dispatchEvent({
      nodeId: stack.id,
      event: "pathChange",
      payload: { path: ["/details"] },
      seq: 9,
    });
    expect(result).toEqual({
      handled: true,
      accepted: false,
      reason: "declined",
    });
    // Nothing mounted…
    expect(findByType(host.lastCommit!.root!, "Toggle")).toHaveLength(0);
    // …but the seq is still acked (CX-010), so native rolls back, never hangs.
    expect(host.lastCommit!.seq).toBe(9);
  });

  it("acks handlerless and unknown-node proposals so native can roll back (CX-010)", () => {
    const host = new MemoryHost();
    const root = mountApp(<FoldingStack>{routes}</FoldingStack>, host);
    // A node with no onPathChange handler (the home Text).
    const text = findByText(host.lastCommit!.root!, "home")[0];
    expect(
      root.dispatchEvent({
        nodeId: text.id,
        event: "pathChange",
        payload: { path: ["/details"] },
        seq: 12,
      }),
    ).toEqual({ handled: false, accepted: false, reason: "declined" });
    expect(host.lastCommit!.seq).toBe(12);

    // An unknown/stale node id.
    expect(
      root.dispatchEvent({
        nodeId: 9999,
        event: "pathChange",
        payload: { path: ["/details"] },
        seq: 13,
      }),
    ).toEqual({ handled: false, accepted: false, reason: "declined" });
    expect(host.lastCommit!.seq).toBe(13);
  });

  it("unmounts a popped screen's subtree", () => {
    const host = new MemoryHost();
    const root = mountApp(<FoldingStack>{routes}</FoldingStack>, host);
    const stack = findByType(host.lastCommit!.root!, "NavigationStack")[0];
    root.dispatchEvent({
      nodeId: stack.id,
      event: "pathChange",
      payload: { path: ["/details"] },
      seq: 1,
    });
    expect(findByType(host.lastCommit!.root!, "Toggle")).toHaveLength(1);

    // Pop back to root: always accepted, and the subtree leaves the commit.
    const result = root.dispatchEvent({
      nodeId: stack.id,
      event: "pathChange",
      payload: { path: [] },
      seq: 2,
    });
    expect(result).toEqual({ handled: true, accepted: true });
    expect(findByType(host.lastCommit!.root!, "Toggle")).toHaveLength(0);
    expect(findByText(host.lastCommit!.root!, "home")).toHaveLength(1);
  });

  it("keeps EVERY entry of a multi-screen stack serialized, not just the top", () => {
    // Covered screens must keep their subtree: SwiftUI still holds their
    // destination views, and popping back must land on content instantly.
    const host = new MemoryHost();
    const root = mountApp(
      <FoldingStack>
        <NavigationRoute path="/">
          <Text>home</Text>
        </NavigationRoute>
        <NavigationRoute path="/a">
          <Text>screen-a</Text>
        </NavigationRoute>
        <NavigationRoute path="/b">
          <Text>screen-b</Text>
        </NavigationRoute>
      </FoldingStack>,
      host,
    );
    const stack = findByType(host.lastCommit!.root!, "NavigationStack")[0];
    root.dispatchEvent({
      nodeId: stack.id,
      event: "pathChange",
      payload: { path: ["/a"] },
      seq: 1,
    });
    root.dispatchEvent({
      nodeId: stack.id,
      event: "pathChange",
      payload: { path: ["/a", "/b"] },
      seq: 2,
    });
    const tree = host.lastCommit!.root!;
    expect(findByText(tree, "screen-a")).toHaveLength(1); // covered, mounted
    expect(findByText(tree, "screen-b")).toHaveLength(1); // top, focused
    expect(findByText(tree, "home")).toHaveLength(1); // root always mounts
  });
});

describe("useFocusEffect", () => {
  it("runs on focus and cleans up while covered and on re-focus", () => {
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
    const root = mountApp(tree(["/fx"]), host);
    // Mounted AND focused → the effect runs once.
    expect(log).toEqual(["focus"]);
    // Push another screen ON TOP: the covered entry stays mounted (ARCH-09
    // keeps every active-stack entry serialized) but loses focus → cleanup
    // runs while a bare useEffect would keep going — the reason this hook
    // still matters under lazy mounting.
    root.render(tree(["/fx", "/other"]));
    expect(log).toEqual(["focus", "blur"]);
    expect(findByText(host.lastCommit!.root!, "fx")).toHaveLength(1);
    // Popping back re-focuses the same mounted screen.
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
