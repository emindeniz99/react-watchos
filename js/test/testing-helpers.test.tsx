// The public test harness (react-watchos/testing) — pinned here so the
// helpers consumers lean on cannot drift from the wire they mirror.
import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryHost,
  NavigationProvider,
  NavigationRoute,
  NavigationStack,
  Text,
  useNavigation,
} from "../src/index";
import { requestNotificationPermission } from "../src/notifications";
import {
  findByText,
  installInvokeHost,
  mountApp,
  pushDeepLink,
  resetApp,
} from "../src/testing";

afterEach(resetApp);

describe("mountApp/resetApp", () => {
  it("disposes between tests so the single-root guard never fires (1/2)", () => {
    mountApp(<Text>first</Text>, new MemoryHost());
  });
  it("disposes between tests so the single-root guard never fires (2/2)", () => {
    const host = new MemoryHost();
    mountApp(<Text>second</Text>, host);
    expect(findByText(host.lastCommit!.root!, "second")).toHaveLength(1);
  });
});

describe("installInvokeHost", () => {
  it("records methods + parsed payloads and resolves null by default", async () => {
    const { calls } = installInvokeHost();
    const { invoke } = await import("../src/invoke");
    await expect(
      invoke("bleWrite", { characteristic: "c", value: "x" }),
    ).resolves.toBeNull();
    expect(calls).toEqual([
      { method: "bleWrite", payload: { characteristic: "c", value: "x" } },
    ]);
  });

  it("resolves configured results and rejects thrown {code,message}", async () => {
    installInvokeHost({
      requestNotificationPermission: "granted",
      failing: () => {
        throw { code: "UNAVAILABLE", message: "nope" };
      },
    });
    await expect(requestNotificationPermission()).resolves.toBe("granted");
    const { invoke } = await import("../src/invoke");
    await expect(invoke("failing")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });
});

function LinkedApp() {
  return (
    <NavigationProvider scheme="helper-test">
      <Shell />
    </NavigationProvider>
  );
}

function Shell() {
  const { path, setPath } = useNavigation();
  return (
    <NavigationStack path={path} onPathChange={setPath}>
      <NavigationRoute path="/">
        <Text>home-screen</Text>
      </NavigationRoute>
      <NavigationRoute path="/settings">
        <Text>settings-screen</Text>
      </NavigationRoute>
    </NavigationStack>
  );
}

describe("pushDeepLink", () => {
  it("throws a self-describing error before any app is mounted", () => {
    expect(() => pushDeepLink("helper-test://settings")).toThrow(
      /mount the app first/,
    );
  });

  it("drives a NavigationProvider route change like the platform would", () => {
    const host = new MemoryHost();
    mountApp(<LinkedApp />, host);
    expect(findByText(host.lastCommit!.root!, "settings-screen")).toHaveLength(
      0,
    );
    expect(pushDeepLink("helper-test://settings")).toBe(true);
    expect(findByText(host.lastCommit!.root!, "settings-screen")).toHaveLength(
      1,
    );
  });
});
