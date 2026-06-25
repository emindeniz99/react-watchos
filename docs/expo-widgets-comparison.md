# Expo Widgets SDK vs this project (2026-06, analysis note)

A deliberate comparison against Expo's
[Widgets SDK](https://docs.expo.dev/versions/latest/sdk/widgets/) and
[`@expo/ui`](https://docs.expo.dev/versions/latest/sdk/ui/), to answer: did we
duplicate it, and is there anything worth borrowing? Point-in-time analysis of
the published Expo docs — re-check against current Expo before acting.

## Verdict: not a duplicate — complementary, disjoint platforms

| | **Expo Widgets SDK** | **react-native-watchos (this project)** |
|---|---|---|
| **Platform** | **iOS only** — Home-Screen widgets, Lock-Screen accessories, Live Activities / Dynamic Island. `@expo/ui` lists iOS/Android/tvOS. **No watchOS / Apple Watch.** | **watchOS only** — complications, Smart Stack, `accessoryCorner`, watchOS-26 Controls. |
| **Runtime model** | **Build-time static.** JSX is serialized into SwiftUI templates at build; **no JS engine in the widget** — no hooks/state/async in widget code. A declarative view fed by props. | **Live QuickJS on-device**, *inside the widget extension* too — `render()` is real React, reads shared storage, schedules future timelines, runs Action-button intents while the app is closed. |

So: **same idea** (author Apple widgets in React → SwiftUI), **opposite runtime
on disjoint platforms.** The shared `accessoryCircular/Rectangular/Inline` names
are just WidgetKit's accessory taxonomy (it spans the iOS Lock Screen and watch
complications) — not evidence of overlap. We fill the surface Expo skips: the
wrist, with on-device dynamism Expo's static model can't express.

## Worth borrowing (grounded in our files)

Expo is the more mature SDK; a few of its choices would improve our DX. These
are **candidate seeds**, not commitments — none is scheduled.

| # | Expo choice | Our current state | Value |
|---|---|---|---|
| 1 | `onPress`/control handler **returns new state**; the runtime persists + reloads | ✅ **Adopted** ([intents.ts](../js/src/intents.ts)) — but the *Glance* way, not Expo's return-state: a handler just mutates `Storage` and `handleIntent` auto-reloads when a write happened (dirty-tracked, so a no-op intent doesn't spend the WidgetKit reload budget; multiple writes coalesce to one reload). We kept Storage as the persistence authority instead of returning state, because our store is freeform K/V — returning a state object would be a second source of truth. Footgun (forgotten `publishWidgets()`) removed. | **High** — done |
| 2 | Plugin sets `WKRunsIndependentlyOfCompanionApp` so a standalone watch app needs no manual Xcode step | We *can* merge it ([merge-target-infoplist.cjs:10](../js/plugin/merge-target-infoplist.cjs)) but the consumer must specify it — it isn't defaulted/documented for the standalone case | **Med** — a *defaulting/docs* gap, not a missing capability; closes a manual-step surprise |
| 3 | `updateSnapshot()` vs `updateTimeline()` — a light single-state push vs a full timeline rebuild | `publishWidgets()` always recomputes **every** kind × family × instance ([widgets.ts:208](../js/src/widgets.ts), `renderWidgets` [:141](../js/src/widgets.ts)) | **Med** — a cheaper snapshot path for frequent single-state updates |
| 4 | A shared **file** URL accessor (Expo `widgetsDirectory`) for image/data the widget reads | `Storage` is `getItem`/`setItem` over UserDefaults only ([storage.ts:12](../js/src/storage.ts)) — no shared-file handle | **Low/Med** — needed for image complications backed by files |
| 5 | Explicit named per-instance `environment.configuration` | per-instance id is `context.instanceId` ([widgets.ts:41](../js/src/widgets.ts), [:86](../js/src/widgets.ts)) | **Low** — naming/clarity for configurable widgets |
| 6 | Verb naming `reload` / `snapshot` / `timeline` | `publishWidgets` / `renderWidgets` | **Low** — alignment with a familiar vocabulary |

Items 1 and 2 are the high-leverage ones (a footgun fix and a manual-step
closer); they overlap with the DX track (DX-1…7) more than with any defect.

## Strategic read

Complementary, not redundant. Expo proves the **demand** and the **DX bar** for
React-authored Apple widgets; this project extends that to the **wrist**, with a
heavier on-device-engine architecture that buys dynamism (live render, future
timelines, in-extension intents) Expo's build-time-static model deliberately
trades away. No reason to change course; there are concrete DX nudges to adopt.
