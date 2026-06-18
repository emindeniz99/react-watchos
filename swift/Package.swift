// swift-tools-version:6.0
import PackageDescription

// The Swift host for react-native-watchos: the QuickJS engine, the runtime
// that embeds it, the generated wire models, and the SwiftUI interpreter that
// renders committed trees. A consumer's watch target depends on this package
// instead of copying ~2k lines of Swift + the vendored C.
//
// Linux-verifiable targets (CI, `swift build --target ...`):
//   CQuickJS          the vendored quickjs-ng, exposed via a module map
//   ReactWatchCore    Foundation-only wire models (codegen output) + storage
//   ReactWatchRuntime the QuickJS embedding (JSRuntime) — Foundation + C only
// macOS/watchOS-only (the gate — needs Xcode):
//   ReactWatchHost    SwiftUI interpreter + native bridges + public root view
let package = Package(
    name: "ReactWatchHost",
    platforms: [.watchOS(.v10), .iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "ReactWatchCore", targets: ["ReactWatchCore"]),
        .library(name: "ReactWatchRuntime", targets: ["ReactWatchRuntime"]),
        .library(name: "ReactWatchHost", targets: ["ReactWatchHost"]),
    ],
    targets: [
        .target(name: "CQuickJS"),
        .target(name: "ReactWatchCore"),
        .target(
            name: "ReactWatchRuntime",
            dependencies: ["CQuickJS"]
        ),
        .target(
            name: "ReactWatchHost",
            dependencies: ["CQuickJS", "ReactWatchCore", "ReactWatchRuntime"]
        ),
    ],
    cLanguageStandard: .gnu11
)
