[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [testing](../README.md) / installInvokeHost

# Function: installInvokeHost()

> **installInvokeHost**(`handlers?`): [`InvokeHost`](../interfaces/InvokeHost.md)

Defined in: [js/src/testing.ts:174](https://github.com/emindeniz99/react-watchos/blob/main/js/src/testing.ts#L174)

Creates and installs a `__host` whose invoke channel records every call and
settles it on a microtask — the wire every fallible API (BLE, health,
connectivity, notifications, …) rides. Without it, testing any of those
APIs means hand-rolling `__host.invoke` + `__resolveInvoke` +
`queueMicrotask`. Returns the recorded calls plus `uninstall` (`resetApp`
also removes it).

```ts
const { calls } = installInvokeHost({
  requestNotificationPermission: "granted",
  // reject a method by throwing the {code, message} native would send
  bleConnect: () => {
    throw { code: "UNAVAILABLE", message: "bluetooth is off" };
  },
});
await requestNotificationPermission();
expect(calls[0]).toEqual({ method: "requestNotificationPermission", payload: undefined });
await expect(bleConnect({ id: "d" })).rejects.toMatchObject({ code: "UNAVAILABLE" });
```

## Parameters

### handlers?

[`InvokeHandlers`](../type-aliases/InvokeHandlers.md) = `{}`

## Returns

[`InvokeHost`](../interfaces/InvokeHost.md)
