import Foundation

#if canImport(FoundationNetworking)
import FoundationNetworking  // URLRequest/HTTPURLResponse split out on Linux
#endif

/// Decodes a js/src/fetch.ts request into a `URLRequest`. The host just hands
/// the resulting request to `URLSession`; the parsing/validation lives here so
/// it builds and is unit-tested on Linux (Foundation-only).
public struct FetchPlan: Sendable {
    public let request: URLRequest
    /// The originally-requested URL string (response `url` falls back to it).
    public let url: String

    private struct Payload: Decodable {
        let url: String
        let method: String
        let headers: [String: String]?
        let body: String?
    }

    public init?(json: String) {
        // Require an absolute URL with a scheme. (URL(string:"") is nil on
        // Apple but non-nil on Linux, so check the scheme explicitly.)
        guard
            let payload = try? JSONDecoder().decode(
                Payload.self, from: Data(json.utf8)
            ),
            let parsed = URL(string: payload.url),
            parsed.scheme != nil
        else { return nil }
        var request = URLRequest(url: parsed)
        // Bound a hung socket at 30s instead of URLSession's 60s default —
        // a watch fetch slot is scarce (NF-34). JS-side cancellation
        // (AbortController / the `timeout` option) still fires earlier when
        // the caller asks for it.
        request.timeoutInterval = 30
        request.httpMethod = payload.method
        payload.headers?.forEach {
            request.setValue($0.value, forHTTPHeaderField: $0.key)
        }
        if let body = payload.body { request.httpBody = Data(body.utf8) }
        self.request = request
        url = payload.url
    }
}

/// How a response body crosses the bridge — or whether it may at all.
public enum FetchBody: Sendable, Equatable {
    /// UTF-8-decodable body, carried verbatim.
    case text(String)
    /// Non-UTF-8 (binary) body, base64-encoded so it isn't silently lost.
    case base64(String)
    /// Body exceeds the cap; the host must reject rather than bridge it.
    case tooLarge(bytes: Int, limit: Int)
}

/// Builds the JS Response payload (js/src/fetch.ts) from the pieces the host
/// pulls out of the URLSession completion. Pure + Foundation-only, so the
/// response shape (status/statusText/url/body/bodyEncoding/headers) and the
/// body classification are unit-tested on Linux.
public enum FetchResponse {
    /// Cap on a bridged response body. The whole body is UTF-8/base64-encoded
    /// into one string, JSON-wrapped, then copied again into the QuickJS heap;
    /// on a memory-tight watch a large download can exhaust it. 5 MiB is a
    /// generous ceiling for the text/JSON APIs a watch app realistically hits
    /// while still failing loud well before OOM.
    public static let defaultMaxBodyBytes = 5 * 1024 * 1024

    /// Decides how (or whether) a raw response body crosses the bridge.
    public static func classifyBody(
        _ data: Data?, maxBytes: Int = defaultMaxBodyBytes
    ) -> FetchBody {
        let data = data ?? Data()
        if data.count > maxBytes {
            return .tooLarge(bytes: data.count, limit: maxBytes)
        }
        if let text = String(data: data, encoding: .utf8) {
            return .text(text)
        }
        return .base64(data.base64EncodedString())
    }

    public static func json(
        status: Int,
        url: String,
        body: String,
        headers: [String: String],
        bodyEncoding: String = "utf8"
    ) -> String {
        let payload: [String: Any] = [
            "status": status,
            "statusText": HTTPURLResponse.localizedString(forStatusCode: status),
            "url": url,
            "body": body,
            "bodyEncoding": bodyEncoding,
            "headers": headers,
        ]
        return (try? JSONSerialization.data(withJSONObject: payload))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
}
