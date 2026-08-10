# Changelog

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
