[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [testing](../README.md) / InvokeHost

# Interface: InvokeHost

Defined in: [js/src/testing.ts:130](https://github.com/emindeniz99/react-watchos/blob/main/js/src/testing.ts#L130)

Handle returned by [installInvokeHost](../functions/installInvokeHost.md).

## Properties

### calls

> **calls**: [`RecordedInvoke`](RecordedInvoke.md)[]

Defined in: [js/src/testing.ts:139](https://github.com/emindeniz99/react-watchos/blob/main/js/src/testing.ts#L139)

Every invoke in call order, with the payload already parsed.

***

### host

> **host**: `object`

Defined in: [js/src/testing.ts:137](https://github.com/emindeniz99/react-watchos/blob/main/js/src/testing.ts#L137)

The invoke-only `__host` object the call installed. A suite that keeps
its own full `__host` mock grafts the channel on instead of being
replaced by it — `__host = { ...myHost, invoke: host.invoke }` (this
package's own `installMockHost` test helper does exactly that).

#### invoke()

> **invoke**(`id`, `method`, `payloadJson`): `void`

##### Parameters

###### id

`number`

###### method

`string`

###### payloadJson

`string`

##### Returns

`void`

***

### uninstall

> **uninstall**: () => `void`

Defined in: [js/src/testing.ts:144](https://github.com/emindeniz99/react-watchos/blob/main/js/src/testing.ts#L144)

Removes the installed `__host` — a no-op if something else was installed
over it since (`resetApp` removes whatever `__host` is current).

#### Returns

`void`
