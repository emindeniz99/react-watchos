import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  dispatchNativeEvent,
  MemoryHost,
  onRemotePush,
  onRemotePushRegistrationError,
  onRemotePushToken,
  REMOTE_PUSH_EVENT,
  REMOTE_PUSH_REGISTRATION_ERROR_EVENT,
  REMOTE_PUSH_TOKEN_EVENT,
  type RemotePushNotification,
  registerForRemoteNotifications,
  runApp,
  Text,
  unregisterAllNativeListeners,
} from "../src/index";
import { installMockHost } from "./helpers";

afterEach(() => {
  unregisterAllNativeListeners();
  delete (globalThis as Record<string, unknown>).__host;
  delete (globalThis as Record<string, unknown>).__pushNativeEvent;
  delete (globalThis as Record<string, unknown>).__dispatchEvent;
});

type PushFn = (name: string, payloadJson?: string) => boolean;

describe("remote push (APNs)", () => {
  it("registerForRemoteNotifications routes via invoke and resolves the hex token", async () => {
    const host = installMockHost();
    const token = await registerForRemoteNotifications();
    // Routed through the generic invoke channel (SD-1), not a direct host method.
    expect(host.invoke).toHaveBeenCalledWith(
      expect.any(Number),
      "registerForRemoteNotifications",
      "",
    );
    expect(token).toBe("a1b2c3d4e5f6");
  });

  it("rejects UNAVAILABLE without a push-capable host", async () => {
    await expect(registerForRemoteNotifications()).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });

  it("rejects with the native reason when registration fails", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation((id: number) => {
      (
        globalThis as {
          __rejectInvoke?: (id: number, errorJson: string) => void;
        }
      ).__rejectInvoke?.(
        id,
        JSON.stringify({
          code: "UNAVAILABLE",
          message: "no valid aps-environment entitlement",
        }),
      );
    });
    await expect(registerForRemoteNotifications()).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "no valid aps-environment entitlement",
    });
  });

  it("routes each remote-push event to its typed listener and unsubscribes", () => {
    const pushes: RemotePushNotification[] = [];
    const tokens: string[] = [];
    const errors: string[] = [];
    const offs = [
      onRemotePush((notification) => pushes.push(notification)),
      onRemotePushToken((token) => tokens.push(token)),
      onRemotePushRegistrationError((message) => errors.push(message)),
    ];

    dispatchNativeEvent(REMOTE_PUSH_EVENT, {
      aps: { "content-available": 1 },
      orderId: 7,
    });
    dispatchNativeEvent(REMOTE_PUSH_TOKEN_EVENT, { token: "a1b2c3" });
    dispatchNativeEvent(REMOTE_PUSH_REGISTRATION_ERROR_EVENT, {
      message: "sandbox mismatch",
    });

    // The handlers get the UNWRAPPED typed values, not the raw payload shape.
    expect(pushes).toEqual([{ aps: { "content-available": 1 }, orderId: 7 }]);
    expect(tokens).toEqual(["a1b2c3"]);
    expect(errors).toEqual(["sandbox mismatch"]);

    for (const off of offs) off();
    dispatchNativeEvent(REMOTE_PUSH_EVENT, { aps: {} });
    dispatchNativeEvent(REMOTE_PUSH_TOKEN_EVENT, { token: "ff" });
    dispatchNativeEvent(REMOTE_PUSH_REGISTRATION_ERROR_EVENT, {
      message: "x",
    });
    expect(pushes).toHaveLength(1); // no fire after unsubscribe
    expect(tokens).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("updates the UI live when a remote push is delivered", () => {
    function OrderStatus() {
      const [status, setStatus] = useState("waiting");
      useEffect(
        () => onRemotePush((n) => setStatus(String(n.status ?? ""))),
        [],
      );
      return <Text>{status}</Text>;
    }
    const host = new MemoryHost();
    runApp(<OrderStatus />, host);
    expect(host.lastCommit!.root!.props.text).toBe("waiting");

    // Simulate the native delegate delivering a push
    // (didReceiveRemoteNotification -> __pushNativeEvent("remotePush", ...)).
    const push = (globalThis as { __pushNativeEvent?: PushFn })
      .__pushNativeEvent!;
    const handled = push(
      REMOTE_PUSH_EVENT,
      JSON.stringify({ aps: { "content-available": 1 }, status: "shipped" }),
    );

    // `handled` is what native maps to WKBackgroundFetchResult.newData.
    expect(handled).toBe(true);
    expect(host.lastCommit!.root!.props.text).toBe("shipped");
  });

  // The Swift host pushes these exact event names (ReactWatchHost.swift
  // remotePushDidRegister/DidFail/DidReceive). Pin them so a JS rename can't
  // silently desync from native.
  it("event-name constants match the native push strings", () => {
    expect(REMOTE_PUSH_EVENT).toBe("remotePush");
    expect(REMOTE_PUSH_TOKEN_EVENT).toBe("remotePush.token");
    expect(REMOTE_PUSH_REGISTRATION_ERROR_EVENT).toBe(
      "remotePush.registrationError",
    );
  });
});
