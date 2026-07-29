[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ScenePhase

# Type Alias: ScenePhase

> **ScenePhase** = `"active"` \| `"inactive"` \| `"background"`

Defined in: [js/src/appState.ts:80](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/appState.ts#L80)

SwiftUI's `ScenePhase`, as the host pushes it.

- `active` — on screen and interactive.
- `inactive` — on screen but should pause: the Now Playing view is up, the
  user is scrubbing the Control Center, a sheet is being dismissed.
- `background` — not on screen. Effect cleanups do **not** run here (the app
  is not unmounted), which is why this event exists.
