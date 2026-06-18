// swift-tools-version:6.0
import PackageDescription

// Linux-runnable contract tests: each target depends on the SwiftPM package's
// ReactWatchCore (the codegen'd wire models, the single source of truth) and
// decodes a fixture the JS serializer produced. This proves the JS<->Swift
// wire schema in actual Swift on Linux. The SwiftUI/WidgetKit layers
// (ReactWatchHost) still require macOS — see the build workflow.
//
// Built in Swift 6 language mode (strict concurrency) with warnings treated
// as errors, so the shared wire models stay type- and concurrency-clean.
let strict: [SwiftSetting] = [.unsafeFlags(["-warnings-as-errors"])]

let package = Package(
    name: "ContractTests",
    dependencies: [
        .package(path: "../swift")
    ],
    targets: [
        .executableTarget(
            name: "CommitContract",
            dependencies: [
                .product(name: "ReactWatchCore", package: "swift")
            ],
            path: "Sources/CommitContract",
            swiftSettings: strict
        ),
        .executableTarget(
            name: "WidgetContract",
            dependencies: [
                .product(name: "ReactWatchCore", package: "swift")
            ],
            path: "Sources/WidgetContract",
            swiftSettings: strict
        ),
    ]
)
