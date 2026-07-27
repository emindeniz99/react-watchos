[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / markUpdateHealthy

# Function: markUpdateHealthy()

> **markUpdateHealthy**(): `Promise`\<`void`\>

Defined in: [js/src/update.ts:139](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/update.ts#L139)

Confirms that this launch of this bundle is healthy — ARCH-04's explicit
`bundleReady` signal. Calling it clears the device's crash-loop boot counter
and promotes the running OTA bundle to the known-good rollback target.

It is a NO-OP unless the app's native side opted in with
`OTAConfig(healthSignal: .explicit)`. Under the default `.firstCommit`
policy the first rendered tree already did this, so calling it costs one
bridge round-trip and changes nothing — which is the point: a bundle ships
the call unconditionally and each binary decides whether it matters.

⚠️ Under `.explicit` there is no timer and no grace period. A bundle that
never calls this is rolled back after 3 launches — to the previous
known-good bundle, or to the one shipped in the app binary. That is the
contract, not a failure mode: the counter is the only enforcement.

Call it **after your own smoke checks** — the first real screen rendered,
the session restored, whatever "this bundle works" means for your app — and
never at module top level, where it would confirm nothing more than "the
file parsed" and give up the whole guarantee.

```ts
useEffect(() => {
  if (dashboardLoaded && !loadError) markUpdateHealthy();
}, [dashboardLoaded, loadError]);
```

Never rejects (mirrors getUpdateState): with no invoke-capable host
(tests/Node) there is nothing to confirm, so it resolves silently.

## Returns

`Promise`\<`void`\>
