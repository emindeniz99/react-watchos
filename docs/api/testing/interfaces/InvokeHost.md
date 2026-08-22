[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [testing](../README.md) / InvokeHost

# Interface: InvokeHost

Defined in: [js/src/testing.ts:136](https://github.com/emindeniz99/react-watchos/blob/main/js/src/testing.ts#L136)

Handle returned by [installInvokeHost](../functions/installInvokeHost.md).

## Properties

### calls

> **calls**: [`RecordedInvoke`](RecordedInvoke.md)[]

Defined in: [js/src/testing.ts:145](https://github.com/emindeniz99/react-watchos/blob/main/js/src/testing.ts#L145)

Every invoke in call order, with the payload already parsed.

***

### host

> **host**: `object`

Defined in: [js/src/testing.ts:143](https://github.com/emindeniz99/react-watchos/blob/main/js/src/testing.ts#L143)

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

Defined in: [js/src/testing.ts:150](https://github.com/emindeniz99/react-watchos/blob/main/js/src/testing.ts#L150)

Removes the installed `__host` — a no-op if something else was installed
over it since (`resetApp` removes whatever `__host` is current).

#### Returns

`void`
