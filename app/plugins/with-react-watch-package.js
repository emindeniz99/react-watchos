// The watch + widget targets consume the local SwiftPM package at
// projects/react-native-watchos/swift:
//   • "React Watch"         -> product ReactWatchHost
//   • "React Watch Widgets" -> products ReactWatchCore + ReactWatchRuntime
//
// This replaces the old Objective-C bridging-header approach: the QuickJS
// engine is now a Clang module (CQuickJS) vended by the package, imported in
// Swift as `import CQuickJS` — no bridging header, no per-target header search
// paths.
//
// Wiring a LOCAL Swift package into an @bacons/apple-targets–generated target
// can't be done reliably through the pbxproj here (the `xcode` lib has no
// local-package API) and is unverifiable on Linux. So this plugin is a
// documented pass-through; do the link once in Xcode after `expo prebuild`:
//
//   File ▸ Add Package Dependencies… ▸ Add Local… ▸ select ../swift
//   then add ReactWatchHost to "React Watch", and ReactWatchCore +
//   ReactWatchRuntime to "React Watch Widgets".
//
// (Tracked in the roadmap: a published SwiftPM package would let prebuild add
// it as a normal remote dependency and drop this manual step.)
module.exports = function withReactWatchPackage(config) {
  return config;
};
