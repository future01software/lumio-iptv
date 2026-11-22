// swift-tools-version: 5.10
import PackageDescription

// Platform-neutral core (models, provider clients, parsers, storage) shared by the
// iPhone app and a future Apple TV target. No UIKit/SwiftUI in here.
let package = Package(
    name: "LumioCore",
    platforms: [.iOS(.v17), .tvOS(.v17), .macOS(.v14)],
    products: [.library(name: "LumioCore", targets: ["LumioCore"])],
    targets: [
        .target(name: "LumioCore"),
        .testTarget(name: "LumioCoreTests", dependencies: ["LumioCore"]),
    ]
)
