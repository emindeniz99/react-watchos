// swift-tools-version:5.9
import PackageDescription

// Linux-runnable contract tests: each target compiles the REAL, Foundation
// -only model file from the watch/widget targets (symlinked, so no drift)
// and decodes a fixture the JS serializer produced. This proves the JS<->
// Swift wire schema in actual Swift on Linux. The SwiftUI/WidgetKit layers
// still require macOS (see .github/workflows/react-native-watchos-build.yml).
let package = Package(
    name: "ContractTests",
    targets: [
        .executableTarget(name: "CommitContract", path: "Sources/CommitContract"),
        .executableTarget(name: "WidgetContract", path: "Sources/WidgetContract"),
    ]
)
