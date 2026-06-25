# DX & integration review — Claude Opus — 2026-06-25 18:59 +03

Answers the owner's questions: are we a clean "npm install + config plugin"
package yet? what's missing? is it pleasant — would devs *like* it? is the
phone↔watch story real? How do we compare to how the ecosystem does watchOS+Expo?

- **Reviewed:** `main` @ `d3d3f24`, plus I **ran the example** (see below).
- **Method:** read the plugin, the example, the connectivity bridges; built the
  example watch bundle; checked the ecosystem ([expo-apple-targets](https://github.com/EvanBacon/expo-apple-targets),
  its [watch guide](https://github.com/EvanBacon/expo-apple-targets), the
  [prebuild watch-wiring issue #175](https://github.com/EvanBacon/expo-apple-targets/issues/175),
  [react-native-watch-connectivity], [expo-watch-connectivity](https://github.com/ixacik/expo-watch-connectivity)).

## Headline verdict

**The value is real and differentiated; the on-ramp is the weak point.**

- **Would a dev love it?** For the target user — an RN/Expo dev who wants a watch
  feature without learning SwiftUI — *writing the UI* is genuinely lovable. The
  whole ecosystem assumes **watch UI = pure Swift/SwiftUI** (that's literally how
  apple-targets frames it). We let them write it in **React**, with a rich
  primitive set, navigation, widgets/complications, and **OTA updates**. Nobody
  else offers that. That's a "wow", not a me-too.
- **But the first 30 minutes hurt.** Getting from `npm install` to a running
  watch target still needs a post-prebuild step, hand-authored Swift glue, and
  (today) copying a plugin file the example should have used. The thing they'd
  love is gated behind setup friction.

So: **they'd love the authoring, struggle with the adoption.** Fix the on-ramp
(below) and it's genuinely delightful.

## What I verified by running it

```
pnpm example build:watch  →  targets/watch/assets/bundle.js  (471 KB, 52ms)
```
The JS half is **smooth and fast**: write React in `watch-ui/`, one command, a
bundle. Workspace-linked single React instance, no alias glue. This is the good
DX and it's real. (I did **not** run `expo prebuild`/Xcode — that's the macOS
gate and where the documented gaps are.)

## The integration flow today — smooth vs rough

| Step | State |
|------|-------|
| `npm install react-native-watchos` | ✅ |
| Write watch UI in React, `build:watch` → bundle | ✅ verified, fast |
| Add the config plugin → generates watch/widget targets, EAS extensions, pre-registers SwiftPM ref | ✅ the plugin does this ([plugin/index.js](../js/plugin/index.js)) |
| `expo prebuild` finishes the native wiring | ⚠️ **needs a post-prebuild link + Info.plist step** (CX-012); EAS re-runs prebuild so it must be lifecycle-hooked or EAS breaks — a [known apple-targets pain](https://github.com/EvanBacon/expo-apple-targets/issues/175) |
| Write the watch entry (~10 lines Swift) | ⚠️ acceptable, but it's "you still write some Swift" |
| Widget/complication Swift glue | ⚠️ consumer-authored (Phase-2 "own target generation" is out of scope today) |
| `widget: false` later | ❌ stale `expo-target.config.js` left behind (CX-011) |

> **Precisely what the plugin already does** (it does a lot — fair point): at
> prebuild it generates `expo-target.config.js` for watch + widget (so
> apple-targets creates the targets), declares the **EAS app extensions**,
> **pre-registers the SwiftPM package reference**, and is
> `createRunOncePlugin`-wrapped + idempotent. **Only two things land in a
> post-prebuild step, not the plugin:** (1) the authoritative **product linking**
> (`ReactWatchHost` → watch target) — apple-targets adds the targets via its own
> mod at a point we can't reliably order *after*, so the plugin lands only the
> package *reference*; and (2) the **Info.plist deep-merge** — apple-targets
> ignores `expo-target.config.js`'s `infoPlist` (known issue, handled by
> `merge-target-infoplist.cjs`). **DX-2 = pull those two into the
> plugin/prebuild lifecycle** (or a lifecycle-hooked executable) so EAS's
> prebuild re-run can't drop them. That's the "one-step" gap — not "the plugin
> does nothing."

## DX gaps (what's missing / what to do)

- [ ] **DX-1 — the example doesn't dogfood the plugin (CX-020).** [expo-watch-app
  README](../examples/expo-watch-app/README.md) tells you to *copy*
  `with-react-watch-package.js`; `app.json` lists only `@bacons/apple-targets`,
  not `react-native-watchos`. So the headline "add the plugin" flow is **unproven
  by our own example**, and the example *undersells* us. **Fix:** make the Expo
  example a clean-room consumer that uses the published plugin, and make it the
  integration-test fixture.
- [ ] **DX-2 — finish the plugin so prebuild is complete (CX-012).** Own the
  product **linking** and **Info.plist merge** inside the plugin/prebuild
  lifecycle (or a documented executable the lifecycle runs), so there's no manual
  post-prebuild script and EAS's prebuild re-run doesn't break wiring. This is
  the single biggest on-ramp win.
- [ ] **DX-3 — ship a scaffolder.** The ecosystem norm is `npx create-target`
  (drops target files + Swift glue). We make the user hand-create
  `targets/watch/` Swift. A `npx react-native-watchos init` that writes the watch
  entry + a starter widget/intent would match expectations and remove the
  "now write Swift" cliff.
- [ ] **DX-4 — packaging must ship Swift *sources* for the SwiftPM ref to
  resolve from `node_modules`.** CX-001's `files` allowlist must **keep
  `swift/Package.swift` + `swift/Sources/**`** (drop only `.build`), and the
  plugin's `swiftPackageRelativePath` must resolve to
  `node_modules/react-native-watchos/swift` for a real consumer (the example uses
  a repo-relative path). Verify with a packed-tarball install test.
- [ ] **DX-5 — `widget:false` cleanup (CX-011)** so toggling options converges.
- [ ] **DX-7 — npm-consumption smoke test (owner-requested).** Pack the tarball,
  install it into a clean Expo fixture, add the plugin, `expo prebuild`, assert
  the watch target builds — the realistic "use it quickly from npm" check.
  Combines with DX-1 (the example *is* the fixture) and DX-4 (tarball must ship
  `swift/Sources`). This is also how we test the example "from the user's side".

## Connectivity story — real, but not turnkey

- **Watch side: handled by us.** [PhoneConnectivity.swift](../js/swift/Sources/ReactWatchHost/PhoneConnectivity.swift)
  bridges WCSession → the JS push channel (`onPhoneMessage`), and `sendToPhone`
  goes out (sendMessage when reachable, else applicationContext). Clean.
- **Phone side: not us — and that's correct.** The iOS RN app uses an existing
  lib ([react-native-watch-connectivity] / [expo-watch-connectivity](https://github.com/ixacik/expo-watch-connectivity)).
  Reusing those is the right call; don't reinvent WCSession.
- **The gap is the seam.** The two halves meet over a **hand-coordinated message
  shape** with no shared types and no end-to-end example wired up. So "iPhone ↔
  watch UI talk easily" is *possible*, not *turnkey*.
- [ ] **DX-6 — make connectivity delightful:** ship a tiny **typed message
  contract** helper (one `defineMessages<T>()` used on both sides) + a complete
  both-sides example (phone sends → watch React re-renders, and back). That turns
  a "wire it yourself" into the "tadından yenmez" experience. Low effort, high
  delight.

## How we compare to the ecosystem

- **Everyone else writes the watch UI in Swift/SwiftUI** via apple-targets. We're
  the only React-on-watch option → our differentiator is the *authoring model*,
  so the on-ramp must not make people feel like they're back in Xcode-land.
- **We compose apple-targets** (generate its config, add EAS extensions) rather
  than fork it — correct, and it means we inherit its prebuild-wiring issue,
  which is exactly why DX-2 matters.
- **We're conventional where it counts** (config plugin, `createRunOncePlugin`,
  EAS appExtensions, App Group entitlements) — we're just missing the
  *generator* and the *finished linking* that make those tools feel turnkey.

## Recommended DX track (after/with the architecture work)

Order by delight-per-effort: **DX-6** (connectivity contract — small, high
delight) → **DX-1** (dogfooding example = also the integration test) → **DX-2**
(finish plugin linking — the big on-ramp win) → **DX-4** (packaging/tarball
test) → **DX-3** (scaffolder) → **DX-5** (widget:false cleanup). Maps onto backlog
CX-011/012/020 plus the new DX-3/DX-4/DX-6.

**Bottom line:** the product is lovable; the install is not yet. The engine and
authoring DX (verified) are the hard part and they're done well — the remaining
work is on-ramp polish, which is very doable and worth it because the value prop
is genuinely strong.
