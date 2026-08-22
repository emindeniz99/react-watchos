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
  it("records methods + parsed payloads and resolves void by default", async () => {
    const { calls } = installInvokeHost();
    const { invoke } = await import("../src/invoke");
    // The void wire, not a helper-invented null: native resolves a Void op
    // with an empty result string and invoke() surfaces that as undefined.
    await expect(
      invoke("bleWrite", { characteristic: "c", value: "x" }),
    ).resolves.toBeUndefined();
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

  it("routes methods without an entry to the '*' wildcard, with the name", async () => {
    installInvokeHost({
      listed: "value",
      "*": (payload: unknown, method: string) => {
        throw { code: "UNKNOWN_METHOD", message: `${method}:${payload}` };
      },
    });
    const { invoke } = await import("../src/invoke");
    await expect(invoke("listed")).resolves.toBe("value");
    await expect(invoke("unlisted", "p")).rejects.toMatchObject({
      code: "UNKNOWN_METHOD",
      message: "unlisted:p",
    });
  });

  it("treats a method LISTED as undefined as void, not as wildcard bait", async () => {
    installInvokeHost({
      bleConnect: undefined,
      "*": () => {
        throw { code: "UNKNOWN_METHOD", message: "should not fire" };
      },
    });
    const { invoke } = await import("../src/invoke");
    await expect(invoke("bleConnect", { id: "d" })).resolves.toBeUndefined();
  });

  it("rejects a thrown Error as INTERNAL but keeps its message", async () => {
    installInvokeHost({
      failing: () => {
        throw new Error("handler blew up");
      },
    });
    const { invoke } = await import("../src/invoke");
    await expect(invoke("failing")).rejects.toMatchObject({
      code: "INTERNAL",
      message: "handler blew up",
    });
  });

  it("exposes the host so a fuller __host mock can graft the channel on", async () => {
    const { host, calls, uninstall } = installInvokeHost({ ping: "pong" });
    const full = { commit: () => {}, invoke: host.invoke };
    (globalThis as Record<string, unknown>).__host = full;
    const { invoke } = await import("../src/invoke");
    await expect(invoke("ping")).resolves.toBe("pong");
    expect(calls).toEqual([{ method: "ping", payload: undefined }]);
    // uninstall only removes the host IT installed — the graft stays.
    uninstall();
    expect((globalThis as { __host?: unknown }).__host).toBe(full);
  });

  it("uninstall removes its own __host so invoke rejects UNAVAILABLE again", async () => {
    const { uninstall } = installInvokeHost();
    uninstall();
    const { invoke } = await import("../src/invoke");
    await expect(invoke("anything")).rejects.toMatchObject({
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
