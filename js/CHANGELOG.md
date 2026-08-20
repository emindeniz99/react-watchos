# Changelog

## [0.5.0](https://github.com/emindeniz99/react-watchos/compare/react-watchos-v0.4.0...react-watchos-v0.5.0) (2026-08-20)


### ⚠ BREAKING CHANGES

* **build:** buildBundles([...]) and `react-watchos build` now minify. Shipped bundles change bytes, so every OTA releaseId changes (it is FNV-1a over the emitted bytes), and your own components appear in ErrorBoundary/inspector stacks as `at t` rather than `at ShoppingList`. Opt out with --no-minify or { minify: false }. A build script that already passes minify explicitly keeps its own value and is unaffected. If you assert on your bundle's TEXT in a test, build that fixture with the opt-out.

### Features

* **build:** ship minified bundles by default ([1c7e20f](https://github.com/emindeniz99/react-watchos/commit/1c7e20fa61d3e31b22798d9b28057d139fd0704b))
* **swift:** read HRV SDNN and resting heart rate from HealthKit ([5fb6ef0](https://github.com/emindeniz99/react-watchos/commit/5fb6ef0e47c33ff3c08184c3f5c06858840a697a))
* **swift:** read the activity rings and their goals ([8521339](https://github.com/emindeniz99/react-watchos/commit/8521339608d55d889ecb77ef5feecc4720e2a18a))
* **swift:** read the user's saved workout history ([bd66542](https://github.com/emindeniz99/react-watchos/commit/bd665425a82747326df2c13d94964c62c139082e))
* **swift:** stream new health samples while the app is open ([5ecbd8a](https://github.com/emindeniz99/react-watchos/commit/5ecbd8ad4f8c8f5341f19f035baf5b02975ffbb6))
* **swift:** widen the HealthKit read vocabulary to fourteen types ([9cd5808](https://github.com/emindeniz99/react-watchos/commit/9cd5808ddce6ac0c9a80d5f3b5b75fb0305175cf))


### Bug Fixes

* **plugin:** name blood oxygen on the HealthKit permission sheet ([15c6840](https://github.com/emindeniz99/react-watchos/commit/15c6840520fc9e91fb661a69899d102676727306))

## [0.4.0](https://github.com/emindeniz99/react-watchos/compare/react-watchos-v0.3.0...react-watchos-v0.4.0) (2026-08-12)


### ⚠ BREAKING CHANGES

* **js:** a handler function subscribed TWICE and left subscribed now fires twice per event, where the Set's function-identity dedup used to collapse it to one call. That collapse was the bug, not a feature — but it is observable at runtime with no compile error, so consumers who double-subscribe one function (a re-render that registers without cleaning up, two components sharing a module-level callback) will see doubled side effects: two haptics, two state updates, two log lines. Subscribe distinct functions, or unsubscribe on cleanup.

### Bug Fixes

* **js:** drop non-finite widget entry date/relevance from payload ([b93b251](https://github.com/emindeniz99/react-watchos/commit/b93b25194730dfbd9b29625bc70f5a4250266f7b))
* **js:** give each native-event subscription its own identity ([56f765c](https://github.com/emindeniz99/react-watchos/commit/56f765c2ef2866a3f1a352ca34b4bc89c840a641))
* **js:** reinstall the invoke settle bridge on every call, not once ([7becc9a](https://github.com/emindeniz99/react-watchos/commit/7becc9a81585cb32a9c3ef0b2708189780941a04))
* **js:** require dotted-quad literal before treating host as private ([8a08df3](https://github.com/emindeniz99/react-watchos/commit/8a08df384da068d212d6e4ec98b0d310aa176464))
* **plugin:** fail prebuild loudly when the watch target has no Swift ([99bf25a](https://github.com/emindeniz99/react-watchos/commit/99bf25abbb7d671c19f902003af52e97f36d8c56))
* **swift:** defer unhandled-rejection reports until the JS turn drains ([12418dc](https://github.com/emindeniz99/react-watchos/commit/12418dc96db96b7c641758fa07c257c853688945))
* **swift:** hop to main before reading onFinished in bridges ([2d0b37d](https://github.com/emindeniz99/react-watchos/commit/2d0b37de63daad8825a523e0785ae96b51df7679))
* **swift:** make notification-permission isolation truthful ([d1cadfc](https://github.com/emindeniz99/react-watchos/commit/d1cadfcb01458a13eb264c97c0e1c79561861af4))
* **swift:** park watchConnectivity.file events until JS is ready ([4ce1a06](https://github.com/emindeniz99/react-watchos/commit/4ce1a066eb8ae832c4d8437fa1d30825d82c583e))
* **swift:** read session/epoch on main in WorkoutSessionOwner ([a326cf4](https://github.com/emindeniz99/react-watchos/commit/a326cf4228c5a42398b64f9f218da86952e3fa91))
* **swift:** serialize WorkoutPlanBridge's scheduler mutations ([8c97a66](https://github.com/emindeniz99/react-watchos/commit/8c97a669588c6049536b67671e285f0056a9a27f))
* **swift:** verify bundle.qbc's content hash against bundle.js at boot ([ba3c1b0](https://github.com/emindeniz99/react-watchos/commit/ba3c1b0ff5874f4c054ef07c2080769defca01df))
* **swift:** widen transferLock to cover the transferFile call ([c2edc0d](https://github.com/emindeniz99/react-watchos/commit/c2edc0d65bb178b520c9f73645553b856f7e5371))

## [0.3.0](https://github.com/emindeniz99/react-watchos/compare/react-watchos-v0.2.1...react-watchos-v0.3.0) (2026-08-10)


### ⚠ BREAKING CHANGES

* **js:** TabView's `style="carousel"` is now `style="page"`. Unreleased on npm — 0.2.1 has no `style` prop at all — so only trees built against main since 2026-08-10 are affected.

### Features

* **swift:** TabView opts into watchOS's crown-driven verticalPage style ([062db05](https://github.com/emindeniz99/react-watchos/commit/062db055ecbf36bebf8e68d14322fbf93ef26077))


### Bug Fixes

* **js:** TabView's pager style names real SwiftUI styles, and is tested ([38c95d7](https://github.com/emindeniz99/react-watchos/commit/38c95d72ee9d13b7c93348aaf8ddafba17d3eadf))

## [0.2.1](https://github.com/emindeniz99/react-watchos/compare/react-watchos-v0.2.0...react-watchos-v0.2.1) (2026-08-10)


### Bug Fixes

* **swift:** restore the watchOS build under Xcode 26.6 strict concurrency ([0b61c7d](https://github.com/emindeniz99/react-watchos/commit/0b61c7d1b420900b4ef3350c4db827ffc610a7c3))

## [0.2.0](https://github.com/emindeniz99/react-watchos/compare/react-watchos-v0.1.0...react-watchos-v0.2.0) (2026-08-07)


### Features

* **js:** public test harness — mountApp/resetApp, installInvokeHost, pushDeepLink ([050867f](https://github.com/emindeniz99/react-watchos/commit/050867fe4c67028bcf9a04ea8d3fca35766a83ea))


### Bug Fixes

* **build:** pin the automatic JSX runtime in the esbuild preset ([1382e26](https://github.com/emindeniz99/react-watchos/commit/1382e26451fd26616649f456fca3b753d9a335bf))
* **docs:** drop the package version from generated API docs ([4fbc2c3](https://github.com/emindeniz99/react-watchos/commit/4fbc2c32f401b510972bac53cee7cd462a22f4a4))
* **js:** consumers no longer need @types/node to typecheck the shipped source ([723914e](https://github.com/emindeniz99/react-watchos/commit/723914e7c9d1a8150150575036cbe0d7dd99bf39))
* **js:** declare process.env non-optional so strict typecheck passes ([a2edfd2](https://github.com/emindeniz99/react-watchos/commit/a2edfd202801a4bd0c87f0f2def2665ae17b08fd))
* **plugin:** quote the SwiftPM package path in the pbxproj for registry installs ([2178aa5](https://github.com/emindeniz99/react-watchos/commit/2178aa5bc2108e10223afd5c6246b81e048dbc7e))
* **plugin:** refuse a watch target named exactly like the app ([b7e2480](https://github.com/emindeniz99/react-watchos/commit/b7e2480cc29bc110a947ce710ca3f1dc6a43389a))
