// swift-tools-version:6.0
import PackageDescription

// Linux-runnable contract tests: each target compiles the REAL, Foundation
// -only model file from the watch/widget targets (symlinked, so no drift)
// and decodes a fixture the JS serializer produced. This proves the JS<->
// Swift wire schema in actual Swift on Linux. The SwiftUI/WidgetKit layers
// still require macOS (see .github/workflows/react-native-watchos-build.yml).
//
// Built in Swift 6 language mode (strict concurrency) with warnings treated
// as errors, so the shared wire models stay type- and concurrency-clean.
let strict: [SwiftSetting] = [.unsafeFlags(["-warnings-as-errors"])]

let package = Package(
    name: "ContractTests",
    targets: [
        .executableTarget(
            name: "CommitContract",
            path: "Sources/CommitContract",
            swiftSettings: strict
        ),
        .executableTarget(
            name: "WidgetContract",
            path: "Sources/WidgetContract",
            swiftSettings: strict
        ),
    ]
)
