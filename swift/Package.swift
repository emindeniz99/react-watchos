// swift-tools-version:6.0
import PackageDescription

// The Swift host for react-native-watchos: the QuickJS engine, the runtime
// that embeds it, the generated wire models, and the SwiftUI interpreter that
// renders committed trees. A consumer's watch target depends on this package
// instead of copying ~2k lines of Swift + the vendored C.
//
// Targets:
//   CQuickJS          the vendored quickjs-ng, exposed via a module map
//   ReactWatchCore    Foundation-only wire models (codegen) + App Group store
//   ReactWatchRuntime the QuickJS embedding (JSRuntime) — Foundation + C only
//   ReactWatchHost    SwiftUI interpreter + native bridges + public root view
//
// The first three (and `swift test`) build on Linux. ReactWatchHost needs
// SwiftUI/WatchKit/CoreBluetooth/HealthKit, which only exist on an Apple build
// host — and building for watchOS requires a Mac anyway — so it's included
// only there. On Linux the package is fully buildable + testable without it.

#if os(macOS)
let includeAppleHost = true
#else
let includeAppleHost = false
#endif

var products: [Product] = [
    .library(name: "ReactWatchCore", targets: ["ReactWatchCore"]),
    .library(name: "ReactWatchRuntime", targets: ["ReactWatchRuntime"]),
]

var targets: [Target] = [
    .target(name: "CQuickJS"),
    .target(name: "ReactWatchCore"),
    .target(name: "ReactWatchRuntime", dependencies: ["CQuickJS"]),
    // Wire-contract tests: decode real serializer fixtures with the codegen'd
    // models. Runs on Linux via `swift test`.
    .testTarget(
        name: "ReactWatchCoreTests",
        dependencies: ["ReactWatchCore"],
        resources: [.copy("Fixtures")]
    ),
]

if includeAppleHost {
    products.append(.library(name: "ReactWatchHost", targets: ["ReactWatchHost"]))
    targets.append(
        .target(
            name: "ReactWatchHost",
            dependencies: ["CQuickJS", "ReactWatchCore", "ReactWatchRuntime"]
        )
    )
}

let package = Package(
    name: "ReactWatchHost",
    platforms: [.watchOS(.v10), .iOS(.v17), .macOS(.v14)],
    products: products,
    targets: targets,
    cLanguageStandard: .gnu11
)
