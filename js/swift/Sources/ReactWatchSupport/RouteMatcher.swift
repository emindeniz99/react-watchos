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
                params[name] = rest
                return Match(params: params, score: score - 1)
            case .literal(let value):
                guard i < parts.count, parts[i] == value else { return nil }
                score += 2
            case .param(let name):
                guard i < parts.count else { return nil }
                params[name] = [parts[i]]
                score += 1
            }
            i += 1
        }
        if parts.count != segments.count { return nil }
        return Match(params: params, score: score)
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

    private static func parse(_ pattern: String) -> [Segment] {
        segments(of: pattern).map { raw in
            if raw.hasPrefix("[[..."), raw.hasSuffix("]]") {
                return .catchAll(
                    name: String(raw.dropFirst(5).dropLast(2)), optional: true
                )
            }
            if raw.hasPrefix("[..."), raw.hasSuffix("]") {
                return .catchAll(
                    name: String(raw.dropFirst(4).dropLast(1)), optional: false
                )
            }
            if raw.hasPrefix("["), raw.hasSuffix("]") {
                return .param(String(raw.dropFirst().dropLast()))
            }
            return .literal(raw)
        }
    }
}
