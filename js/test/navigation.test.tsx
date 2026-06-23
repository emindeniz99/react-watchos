import { afterEach, describe, expect, it } from "vitest";
import {
  Button,
  MemoryHost,
  matchRoute,
  NavigationProvider,
  NavigationRoute,
  NavigationStack,
  routeFromURL,
  runApp,
  type SerializedNode,
  Text,
  unregisterAllNativeListeners,
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
});
