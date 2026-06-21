import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking // URLRequest/HTTPURLResponse split out on Linux
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
        guard let payload = try? JSONDecoder().decode(
            Payload.self, from: Data(json.utf8)),
            let parsed = URL(string: payload.url),
            parsed.scheme != nil else { return nil }
        var request = URLRequest(url: parsed)
        request.httpMethod = payload.method
        payload.headers?.forEach {
            request.setValue($0.value, forHTTPHeaderField: $0.key)
        }
        if let body = payload.body { request.httpBody = Data(body.utf8) }
        self.request = request
        url = payload.url
    }
}

/// Builds the JS Response payload (js/src/fetch.ts) from the pieces the host
/// pulls out of the URLSession completion. Pure + Foundation-only, so the
/// response shape (status/statusText/url/body/headers) is unit-tested.
public enum FetchResponse {
    public static func json(
        status: Int,
        url: String,
        body: String,
        headers: [String: String]
    ) -> String {
        let payload: [String: Any] = [
            "status": status,
            "statusText": HTTPURLResponse.localizedString(forStatusCode: status),
            "url": url,
            "body": body,
            "headers": headers,
        ]
        return (try? JSONSerialization.data(withJSONObject: payload))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
}
