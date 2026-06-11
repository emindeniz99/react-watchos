# react-native-watchos

## What it does

Write Apple Watch UI in React (JSX, hooks, state) and render it as native
SwiftUI — with the JS engine running **on the watch**, so the app works
standalone without the iPhone. Not a fork of React Native core (impossible
on watchOS — see [docs/research.md](./docs/research.md)); a custom
`react-reconciler` renderer in the spirit of react-native-tvos.

## How to run

See the full sections below once implemented; placeholder during build-out.

```bash
# JS side (works on any OS)
cd js && npm install && npm test && npm run build

# Watch app (macOS + Xcode 16+ only)
cd app && npm install && npx expo prebuild -p ios --clean
```

## Notes / learnings

- To be filled in as the project lands.
