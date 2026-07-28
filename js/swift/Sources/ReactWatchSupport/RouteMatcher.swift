import Foundation

/// Matches a `<NavigationRoute path>` pattern against a concrete pushed route,
/// Next.js/Expo style: `[id]`, `[...rest]` (>= 1 segment), and `[[...rest]]`
/// (optional). Mirrors js/src/navigation.ts `matchRoute` so the host renders
/// the same destination the renderer's `useParams()` resolves. Pure +
/// Foundation-only, so the route selection is unit-tested on Linux.
public struct RouteMatcher {
    public struct Match: Equatable {
        /// Single params map to one value; catch-alls map to the remaining
        /// segments (possibly empty for an optional catch-all).
        public let params: [String: [String]]
        /// Higher = more specific. Literal +2, param +1, catch-all -1, so a
        /// concrete route beats a catch-all that also happens to match it.
        public let score: Int
    }

    private enum Segment: Equatable {
        case literal(String)
        case param(String)
        case catchAll(name: String, optional: Bool)
    }

    public static func match(pattern: String, route: String) -> Match? {
        let segments = parse(pattern)
        let parts = self.segments(of: route)
        var params: [String: [String]] = [:]
        var score = 0
        var i = 0
        for segment in segments {
            switch segment {
            case .catchAll(let name, let optional):
                let rest = Array(parts[min(i, parts.count)...])
                if !optional, rest.isEmpty { return nil }
                params[name] = rest.map(decodeParam)
                return Match(params: params, score: score - 1)
            case .literal(let value):
                // Compare literals DECODED too: patterns are authored raw
                // ("/café") while a valid URL carries the segment
                // percent-encoded — a raw-only compare would make any
                // non-ASCII/space literal unreachable from a deep link.
                // Mirrors js matchRoute.
                guard i < parts.count,
                    parts[i] == value || decodeParam(parts[i]) == value
                else { return nil }
                score += 2
            case .param(let name):
                guard i < parts.count else { return nil }
                params[name] = [decodeParam(parts[i])]
                score += 1
            }
            i += 1
        }
        if parts.count != segments.count { return nil }
        return Match(params: params, score: score)
    }

    /// Percent-decode a captured param segment, falling back to the raw text
    /// on a malformed escape — mirrors js `decodeParam` exactly, so
    /// `useParams()` and the host resolve identical values for the params
    /// `href()` percent-encodes.
    private static func decodeParam(_ segment: String) -> String {
        segment.removingPercentEncoding ?? segment
    }

    /// Picks the highest-scoring pattern that matches `route`, so a concrete
    /// route wins over a catch-all both can match.
    public static func best(
        patterns: [String], route: String
    ) -> (pattern: String, match: Match)? {
        var winner: (pattern: String, match: Match)?
        for pattern in patterns {
            guard let match = match(pattern: pattern, route: route) else { continue }
            if winner == nil || match.score > winner!.match.score {
                winner = (pattern, match)
            }
        }
        return winner
    }

    static func segments(of route: String) -> [String] {
        route.split(separator: "/").map(String.init)
    }

    /// A bracket form only becomes a param or a catch-all when it NAMES one —
    /// an UNNAMED segment (`[]`, `[...]`, `[[...]]`) falls through to the next
    /// form and ultimately to a literal, exactly as js `parsePattern` does.
    ///
    /// This used to accept an empty name and produce a param/catch-all called
    /// `""`, so `/[]` matched any one segment and `/[[...]]` matched anything
    /// at all — patterns js rejects (its three regexes are anchored on `(.+)`,
    /// which needs a non-empty name, so `[]` reads as a literal and `[...]` as
    /// a param named `...`). Next.js, the syntax this mirrors, rejects unnamed
    /// segments at build time, and every documented form here is named, so js
    /// is the authority: a capture with no name to read it back under is not a
    /// wildcard, and a route matching one would render a screen whose
    /// `useParams()` returns nothing.
    private static func parse(_ pattern: String) -> [Segment] {
        segments(of: pattern).map { raw in
            if raw.hasPrefix("[[..."), raw.hasSuffix("]]") {
                let name = String(raw.dropFirst(5).dropLast(2))
                if !name.isEmpty { return .catchAll(name: name, optional: true) }
            }
            if raw.hasPrefix("[..."), raw.hasSuffix("]") {
                let name = String(raw.dropFirst(4).dropLast(1))
                if !name.isEmpty { return .catchAll(name: name, optional: false) }
            }
            if raw.hasPrefix("["), raw.hasSuffix("]") {
                let name = String(raw.dropFirst().dropLast())
                if !name.isEmpty { return .param(name) }
            }
            return .literal(raw)
        }
    }
}
