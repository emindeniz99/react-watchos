[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [testing](../README.md) / installInvokeHost

# Function: installInvokeHost()

> **installInvokeHost**(`handlers?`): `object`

Defined in: [js/src/testing.ts:134](https://github.com/emindeniz99/react-watchos/blob/main/js/src/testing.ts#L134)

Installs a `__host` whose invoke channel records every call and settles it
on a microtask — the wire every fallible API (BLE, health, connectivity,
notifications, …) rides. Returns the recorded calls plus `uninstall`
(`resetApp` also removes it).

```ts
const { calls } = installInvokeHost({ requestNotificationPermission: "granted" });
await requestNotificationPermission();
expect(calls[0]).toEqual({ method: "requestNotificationPermission", payload: undefined });
```

## Parameters

### handlers?

[`InvokeHandlers`](../type-aliases/InvokeHandlers.md) = `{}`

## Returns

`object`

### calls

> **calls**: [`RecordedInvoke`](../interfaces/RecordedInvoke.md)[]

### uninstall

> **uninstall**: () => `void`

#### Returns

`void`
