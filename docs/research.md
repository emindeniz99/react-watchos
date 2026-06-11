# Research: React Native for watchOS — feasibility and chosen architecture

Date: 2026-06-11

## The question

Can we have "React Native for Apple Watch" the way
[react-native-tvos](https://github.com/react-native-tvos/react-native-tvos)
gives us React Native for Apple TV — write the watch UI in JSX, rendered as
native widgets, with the JS engine running on the watch itself?

## Why a react-native-tvos-style fork is impossible on watchOS

react-native-tvos is a *fork of React Native core* with relatively small
deltas. That works because tvOS ships the two things RN core depends on:

| Dependency | iOS | tvOS | watchOS |
|---|---|---|---|
| UIKit (public) | yes | yes | **no** — SwiftUI/WatchKit only |
| JavaScriptCore framework | yes | yes | **no** |
| JIT allowed | no (interpreter/bytecode modes) | no | no |

React Native's renderer (Fabric, previously Paper) maps the React shadow
tree onto `UIView` instances and lays them out with Yoga. On watchOS there
is no public UIKit for Fabric to attach to, and no system JS engine to host
the JavaScript. "Adding watchOS support to RN" would mean building a whole
new host platform — a SwiftUI-backed Fabric, Yoga integration, a
cross-compiled JS engine, module system — comparable to what Microsoft did
for react-native-macos/windows with a dedicated team. Nobody has shipped
this; historical attempts
([conorbuck/react-native-watch](https://github.com/conorbuck/react-native-watch),
[AlexisLeon/react-native-watch](https://github.com/AlexisLeon/react-native-watch))
explicitly do *not* render RN views on the watch, they only bridge messages
to a natively-built watch UI via
[react-native-watch-connectivity](https://github.com/watch-connectivity/react-native-watch-connectivity).

## What does work: the custom-renderer pattern

React itself is renderer-agnostic. `react-reconciler` (the API behind
react-dom and react-native) lets a few hundred lines of "host config" turn
React commits into mutations of any tree you like. Prior art using exactly
this pattern:

- [react-tvml](https://github.com/sergioramos/react-tvml) — React driving
  TVML documents on tvOS via JavaScriptCore.
- [react-ssd1306](https://github.com/doodlewind/react-ssd1306/blob/master/docs/tutorial.md)
  — React reconciler producing draw state for an OLED display; a native
  loop consumes committed state (producer/consumer).
- [Raycast](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast)
  — React-described UI rendered natively on macOS.
- [Espruino/Bangle.js React](https://github.com/orgs/espruino/discussions/1294)
  — a custom reconciler running React *on the phone*, streaming draw
  commands to a 64KB-RAM watch over Bluetooth (the WatchKit 1.0
  architecture). Its hardware budget forced the phone-hosted split; an
  Apple Watch (~1GB RAM) does not need that compromise. Its "transmit only
  changed elements" optimization is worth borrowing if our full-tree
  commits ever get large.

So: run React on the watch inside an embeddable JS engine, give it a host
config that serializes the committed tree to JSON, and render that tree
with a small SwiftUI interpreter. JSX, hooks, and state all work; the
component vocabulary is SwiftUI-like (`VStack`, `Text`, `Button`, …).

## Engine choice

| Engine | Verdict |
|---|---|
| **QuickJS (quickjs-ng)** | **Chosen.** Pure C, zero dependencies, ~370KB, ES2020+, MIT. Embeds by adding its C files to the watch target; builds for `arm64_32`/`arm64`. No JIT — irrelevant, Apple forbids JIT anyway. Runs on Linux (`qjs`), so the production bundle is testable in the exact target engine in CI. |
| Hermes | RN's engine, AOT bytecode would be nice — but no watchOS build target upstream and a heavy CMake cross-compile. Future work. |
| JavaScriptCore | Not shipped on watchOS; building JSC from WebKit source statically is enormous. |
| Duktape | ES5-era; would force a full down-transpile of React and is slower. |
| JerryScript / Espruino | MCU-class ES5 subsets for 64–256KB RAM devices; cannot run React comfortably. |
| Moddable XS | Capable ES2023 embedded engine, but LGPL and a heavier embedding story than QuickJS's drop-in C files. |

App Store note: guideline 2.5.2 prohibits *downloading* executable code;
interpreting JS **bundled with the app** is permitted (JavaScriptCore-based
apps and shipped JS engines rely on this).

## React layer choice

- **react@19 + react-reconciler@0.33 — chosen.** The official
  custom-renderer API used by react-three-fiber, Ink, react-tvml, Raycast.
  Real React: hooks, state, effects.
- Preact + fake-DOM shim — smaller bundle, but requires emulating enough
  DOM for preact's diffing, and isn't React. Documented fallback if bundle
  size or memory ever becomes a problem.
- react-test-renderer — testing only, not a production renderer.

## Is this "React Native"?

React Native = React + a native host platform: Yoga flexbox layout, the
Fabric renderer mapping the shadow tree to UIKit/Android views,
JSI/TurboModules for native APIs, Metro, and the core components
(`<View>`, `<Text>`, StyleSheet). This project shares **no code** with RN
core — RN ecosystem libraries will not run on the watch — but it is the
same *category* of system: a JS engine on the device, JSX + hooks driving
real native widgets, events bridged back to JS. The honest description is
"React for watchOS, built the way react-native-tvos would be built if
watchOS allowed it" — hence the project name, with this caveat stated.

## Alternative considered: phone-hosted rendering

The first design ran React inside the existing RN iPhone app and mirrored
the serialized tree to the watch over WatchConnectivity
(`updateApplicationContext` phone→watch, `sendMessage` for events). It
works and needs no on-watch engine, but every interaction pays a Bluetooth
round-trip and the watch app is dead without the phone — the same
trade-off that made Apple abandon WatchKit 1.0. Rejected in favor of the
on-watch engine; the transport seam in the renderer (`HostBridge`) keeps
the door open to re-adding a phone link later for data sync.

## Constraints accepted

- watchOS app memory budget (~80MB foreground) comfortably fits QuickJS
  (~1–2MB) plus a React bundle (~100–300KB minified).
- This repo's development environment is Linux without Xcode: the JS side
  is fully tested here (vitest + real `qjs`); the Swift side is
  best-effort until built on a Mac with Xcode 16+.
