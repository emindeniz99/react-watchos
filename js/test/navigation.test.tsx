import { afterEach, describe, expect, it } from "vitest";
import {
  Button,
  MemoryHost,
  NavigationProvider,
  routeFromURL,
  runApp,
  type SerializedNode,
  Text,
  unregisterAllNativeListeners,
  useNavigate,
  useNavigation,
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
