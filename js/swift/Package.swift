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
// SwiftUI/WatchKit/CoreBluetooth/HealthKit — frameworks that exist only for the
// *watchOS destination* — so it's only added to the package when the build host
// is a Mac (Linux drops it entirely; that's all SwiftPM can decide at manifest
// time, since the manifest can't see the build destination).
//
// Crucially, the manifest can't tell "swift test on macOS" (destination = the
// Mac, where WatchKit/UIKit don't exist) from "xcodebuild for watchOS". So the
// host's *sources* are each wrapped in `#if os(watchOS)`: they compile fully for
// the watchOS destination and to an empty module everywhere else. That's what
// lets `swift test`/`swift build` run on a Mac — the host is present but empty,
// the Foundation+C targets and the tests build normally, and xcodebuild still
// gets the real host for watchOS.

#if os(macOS)
let includeAppleHost = true
#else
let includeAppleHost = false
#endif

var products: [Product] = [
    .library(name: "ReactWatchCore", targets: ["ReactWatchCore"]),
    .library(name: "ReactWatchSupport", targets: ["ReactWatchSupport"]),
    .library(name: "ReactWatchRuntime", targets: ["ReactWatchRuntime"]),
]

var targets: [Target] = [
    .target(name: "CQuickJS"),
    .target(name: "ReactWatchCore"),
    // Foundation-only platform-support logic (storage, optimistic controls,
    // notification scheduling) extracted from the SwiftUI host so it's
    // unit-tested on Linux instead of riding along in the macOS-only target.
    .target(name: "ReactWatchSupport", dependencies: ["ReactWatchCore"]),
    .target(name: "ReactWatchRuntime", dependencies: ["CQuickJS"]),
    // `swift test`: decode real serializer fixtures with the codegen'd models,
    // unit-test the support logic, and smoke the QuickJS embedding. Runs on
    // Linux (swift test) and on the watchOS simulator (xcodebuild test).
    .testTarget(
        name: "ReactWatchTests",
        dependencies: ["ReactWatchCore", "ReactWatchSupport", "ReactWatchRuntime"],
        resources: [.copy("Fixtures")]
    ),
]

if includeAppleHost {
    products.append(.library(name: "ReactWatchHost", targets: ["ReactWatchHost"]))
    targets.append(
        .target(
            name: "ReactWatchHost",
            dependencies: [
                "CQuickJS", "ReactWatchCore", "ReactWatchSupport",
                "ReactWatchRuntime",
            ]
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
