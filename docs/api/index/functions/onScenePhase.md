[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onScenePhase

# Function: onScenePhase()

> **onScenePhase**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/appState.ts:106](https://github.com/emindeniz99/react-watchos/blob/main/js/src/appState.ts#L106)

Runs `handler` whenever the app's scene phase changes. Returns an
unsubscribe.

The typed wrapper over an event the host has always pushed — `scenePhase` was
reachable only through `registerNativeListener("scenePhase", …)` and a
hand-written `String(p?.phase)`, which is a union this package can spell.

The handler is also called **once on subscribe** with the last phase the host
pushed, so a screen mounted after a transition learns the phase instead of
waiting for the next one. Honest limit: the host pushes on CHANGE only, with
no initial push at launch, so a subscriber that mounts before the first
transition is called with nothing — a launched app is `active` and that is
the state you already have.

**This is not the Always-On signal.** A wrist-down app stays `active`;
SwiftUI defines no `ScenePhase` value for reduced luminance. Use
[onLuminanceReduced](onLuminanceReduced.md) for that — they answer different questions and an
app that needs to stand down needs both.

```tsx
useEffect(() => onScenePhase((phase) => setPaused(phase !== "active")), []);
```

## Parameters

### handler

(`phase`) => `void`

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
