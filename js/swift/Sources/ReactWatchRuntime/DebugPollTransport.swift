#if DEBUG
import Foundation

#if canImport(FoundationNetworking)
import FoundationNetworking  // URLSession/URLRequest split out on Linux
#endif

/// The blocking HTTP half of the DEBUG-only debugger transport
/// (docs/design-dap-debugger.md): one POST to `react-watchos debug`'s
/// `/debug/poll`, waited on synchronously, handed straight back to JS as the
/// return value of `__debugPoll`.
///
/// WHY THIS BLOCKS AND WHY THAT IS SAFE — the crux of the whole design.
/// A debugger paused on a line must hold the JS thread; on the watch that
/// thread is `DispatchQueue.main` (JSRuntime's owning queue for the app
/// runtime). The existing `fetch` shim cannot serve this: it settles by
/// hopping back to the owning queue to call `__resolveFetch`, so JS spinning
/// on main would be waiting for a hop onto the queue it is occupying —
/// a deadlock, not a slow poll.
///
/// `URLSession.shared`'s completion handler runs on the session's OWN
/// delegate queue, never on main. So the request completes and signals the
/// semaphore while main is blocked, and the wait returns. That asymmetry is
/// the entire reason a debugger is reachable here at all, and it is why this
/// must not be "simplified" into the fetch bridge.
///
/// Blocking main freezes the UI while paused. That is what a breakpoint IS.
/// It is also why none of this may exist in a release build — hence the
/// `#if DEBUG` around the file, matching the dev-reload loop it sits beside.
public enum DebugPollTransport {
    /// Default ceiling on one exchange. The dev server long-polls for ~1 s
    /// before answering "nothing yet", so this only has to outlast that plus
    /// a watch-to-Mac round trip. Past it the probe is handed the empty
    /// string, which it reads as "detach" — so a killed dev server costs one
    /// stall of at most this long and then leaves a normally running app,
    /// never a wedged one.
    public static let defaultTimeout: TimeInterval = 5

    /// A handler for `JSRuntime.installDebugPoll(_:)` that talks to
    /// `react-watchos debug` at `url` (default `/debug/poll` on 8790).
    public static func handler(
        url: URL, timeout: TimeInterval = defaultTimeout
    ) -> (String) -> String {
        { state in post(url: url, body: state, timeout: timeout) }
    }

    /// POST `body` and return the response text (empty on any failure —
    /// the probe reads an unparseable answer as "detach", so a dev server
    /// that is not running can never wedge the app).
    public static func post(
        url: URL, body: String, timeout: TimeInterval = defaultTimeout
    ) -> String {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = Data(body.utf8)
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.timeoutInterval = timeout
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let semaphore = DispatchSemaphore(value: 0)
        // `nonisolated(unsafe)`: written once on the URLSession delegate
        // queue and read only after the semaphore below has been signalled,
        // which is the happens-before edge that makes the handoff safe.
        nonisolated(unsafe) var answer = ""
        let task = URLSession.shared.dataTask(with: request) { data, _, _ in
            if let data, let text = String(data: data, encoding: .utf8) {
                answer = text
            }
            semaphore.signal()
        }
        task.resume()
        // Outlast the request's own timeout, then give up: a semaphore that
        // could wait forever would turn a dropped Wi-Fi connection into a
        // permanently frozen watch app.
        if semaphore.wait(timeout: .now() + timeout + 1) == .timedOut {
            task.cancel()
            return ""
        }
        return answer
    }
}
#endif
