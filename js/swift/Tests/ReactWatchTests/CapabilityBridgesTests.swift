// SpeechBridge/AudioBridge are watchOS-only (#if os(watchOS) in
// ReactWatchHost); these tests compile to nothing under `swift test` on
// macOS/Linux and run only on the watchOS simulator via `xcodebuild test`.
#if os(watchOS)
import AVFoundation
import XCTest

@testable import ReactWatchHost

/// Regression coverage for the `onFinished` race fixed 2026-08-11: both
/// bridges used to capture `onFinished` SYNCHRONOUSLY, on whatever thread
/// their AVFoundation delegate method fires on, before hopping to main —
/// racing every reassignment the @MainActor host makes to that same
/// property (including on a runtime reboot). The fix reads `onFinished`
/// only AFTER the hop, so a reassignment that lands before the queued block
/// actually runs is the one observed.
///
/// A real concurrent thread race is inherently non-deterministic and can't
/// be pinned by a fast XCTest, so this drives the SAME defect through a
/// deterministic angle that isolates exactly what the fix changed: whether
/// the delegate call captures the handler at CALL time (synchronously, the
/// bug) or reads it at DELIVERY time (inside the dispatched block, the
/// fix). Enqueuing the delegate call first and reassigning the handler
/// synchronously right after — still ahead of the main queue draining —
/// makes that distinction observable without any real threading, and it is
/// the exact ordering a runtime reboot racing an in-flight callback
/// produces: the reassignment is what boot() does, landing before the
/// still-in-flight callback's queued block runs.
final class CapabilityBridgesTests: XCTestCase {
    /// With the bug reverted (`nonisolated(unsafe) let handler = onFinished`
    /// read BEFORE `DispatchQueue.main.async`), this fails:
    /// `XCTAssertEqual failed: ("["stale"]") is not equal to ("["current"]")`
    /// — the captured-at-call-time "stale" closure is what fires, even
    /// though "current" was already the live handler by the time delivery
    /// happened.
    func testSpeechFinishReadsTheHandlerCurrentAtDeliveryNotAtCallTime() {
        let bridge = SpeechBridge()
        let synthesizer = AVSpeechSynthesizer()
        let utterance = AVSpeechUtterance(string: "hello")
        var observed: [String] = []

        bridge.onFinished = { _ in observed.append("stale") }
        bridge.speechSynthesizer(synthesizer, didFinish: utterance)
        // Synchronous reassignment, landing before finish()'s own queued
        // main.async block gets a chance to run — the runtime-reboot shape.
        bridge.onFinished = { _ in observed.append("current") }

        let drained = expectation(description: "main queue drained")
        DispatchQueue.main.async { drained.fulfill() }
        wait(for: [drained], timeout: 1)

        XCTAssertEqual(
            observed, ["current"],
            "finish() must read onFinished at delivery time, not capture it "
                + "synchronously at the delegate call")
    }

    /// Same defect, same fix, same proof — AudioBridge's onFinished handling
    /// was byte-for-byte the same shape as SpeechBridge's (the bullet that
    /// tracked this called it "the identical shape").
    func testAudioFinishReadsTheHandlerCurrentAtDeliveryNotAtCallTime() throws {
        let bridge = AudioBridge()
        let player = try Self.makeSilentAudioPlayer()
        var observed: [String] = []

        bridge.onFinished = { observed.append("stale") }
        bridge.audioPlayerDidFinishPlaying(player, successfully: true)
        bridge.onFinished = { observed.append("current") }

        let drained = expectation(description: "main queue drained")
        DispatchQueue.main.async { drained.fulfill() }
        wait(for: [drained], timeout: 1)

        XCTAssertEqual(
            observed, ["current"],
            "audioPlayerDidFinishPlaying must read onFinished at delivery "
                + "time, not capture it synchronously at the delegate call")
    }

    /// A minimal, real, playable file — AVAudioPlayer(contentsOf:) throws on
    /// anything it can't decode, so the delegate call needs an actual valid
    /// player, not a mock. A tiny silent buffer written as CAF is the
    /// cheapest way to get one without shipping a fixture audio file.
    private static func makeSilentAudioPlayer() throws -> AVAudioPlayer {
        let format = AVAudioFormat(standardFormatWithSampleRate: 8000, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 800)!
        buffer.frameLength = 800
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("caf")
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        try file.write(from: buffer)
        return try AVAudioPlayer(contentsOf: url)
    }
}
#endif
