import Foundation

/// OTA transport policy (review §6.11c): update URLs must be https. Plain
/// http is allowed ONLY for the documented dev flow — loopback and
/// private-LAN hosts (the plugin's NSAllowsLocalNetworking scope:
/// localhost/127.*, 10.*, 192.168.*, 172.16-31.*, mDNS *.local — "your Mac
/// on the LAN" — plus the IPv6 loopback `[::1]`, and ONLY loopback there,
/// see `isLoopbackIPv6`). The Ed25519 signature protects bundle INTEGRITY
/// regardless; this closes the cleartext exposure that remains — manifest
/// metadata privacy and an on-path attacker shaping freeze/suppression
/// responses. Mirrors js/src/update.ts `updateURLViolation` so the JS update
/// flow and the native recovery path enforce one policy; pure Foundation,
/// Linux-tested.
public enum UpdateURLPolicy {
    /// The refusal reason, or nil when the URL is allowed.
    public static func violation(of urlString: String) -> String? {
        guard let url = URL(string: urlString),
            let scheme = url.scheme?.lowercased(),
            let host = url.host?.lowercased()
        else {
            return "update URL must be absolute (https://…): \(urlString)"
        }
        if scheme == "https" { return nil }
        if scheme == "http", isPrivateHost(host) { return nil }
        return
            "update URL must be https — plain http is allowed only for "
            + "localhost/private-LAN dev hosts: \(urlString)"
    }

    /// A bare dotted-quad IPv4 literal (each octet 0-255), or nil when `host`
    /// isn't ENTIRELY one — e.g. a DNS name that merely starts with digits and
    /// a dot (`10.attacker.com`). Requires exactly 4 non-empty, all-digit,
    /// <=3-character parts: mirrors js/src/update.ts's `parseIPv4Literal`, so
    /// the two policies classify the same set of hosts as private.
    private static func ipv4Octets(_ host: String) -> (Int, Int, Int, Int)? {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        var octets: [Int] = []
        for part in parts {
            guard part.count <= 3, part.allSatisfy(\.isNumber),
                let value = Int(part), value <= 255
            else { return nil }
            octets.append(value)
        }
        return (octets[0], octets[1], octets[2], octets[3])
    }

    /// The 8 hextets of an IPv6 literal, or nil when `literal` isn't entirely
    /// one. Handles `::` zero-compression; refuses zone ids (`%…`) and dotted
    /// IPv4 tails (`::ffff:1.2.3.4`) — neither spells the plain loopback this
    /// feeds, and refusal is the safe side of a transport policy. Mirrors
    /// js/src/update.ts's `parseIPv6Hextets`, so the two policies classify
    /// the same set of hosts.
    private static func ipv6Hextets(_ literal: String) -> [UInt16]? {
        if literal.contains("%") || literal.contains(".") { return nil }
        let halves = literal.components(separatedBy: "::")
        guard halves.count <= 2 else { return nil }
        func groups(_ half: String) -> [UInt16]? {
            if half.isEmpty { return [] }
            var out: [UInt16] = []
            for part in half.split(separator: ":", omittingEmptySubsequences: false) {
                // ASCII hex only (the caller lowercased the host), 1-4 digits
                // — the same character class as the JS side's regex, so a
                // group Int() would tolerate (a leading "+") stays refused.
                guard (1...4).contains(part.count),
                    part.allSatisfy({ "0123456789abcdef".contains($0) }),
                    let value = UInt16(part, radix: 16)
                else { return nil }
                out.append(value)
            }
            return out
        }
        guard let head = groups(halves[0]),
            let tail = halves.count == 2 ? groups(halves[1]) : .some([])
        else { return nil }
        // Uncompressed needs all 8 groups spelled; a `::` must stand for at
        // least one zero group (RFC 4291), so at most 7 may be spelled.
        let compressed = halves.count == 2
        if compressed ? head.count + tail.count > 7 : head.count != 8 {
            return nil
        }
        let zeros = [UInt16](repeating: 0, count: 8 - head.count - tail.count)
        return head + zeros + tail
    }

    /// Whether an IPv6 literal is EXACTLY the loopback `::1` — the only IPv6
    /// dev host. Recorded decision (roadmap 2026-08-12): ULA `fc00::/7` and
    /// link-local `fe80::/10` are deliberately NOT the IPv6 parallel of the
    /// private-LAN IPv4 ranges — link-local needs a zone id the fetch stack
    /// can't carry, and neither is inside the plugin's
    /// NSAllowsLocalNetworking dev scope this policy documents. They are
    /// refused EXPLICITLY, not just by falling through the loopback compare,
    /// so the scoping survives even if the accept below is ever widened.
    private static func isLoopbackIPv6(_ literal: String) -> Bool {
        guard let hextets = ipv6Hextets(literal) else { return false }
        if hextets[0] & 0xFE00 == 0xFC00 { return false }  // ULA fc00::/7
        if hextets[0] & 0xFFC0 == 0xFE80 { return false }  // link-local fe80::/10
        return hextets == [0, 0, 0, 0, 0, 0, 0, 1]
    }

    private static func isPrivateHost(_ host: String) -> Bool {
        if host == "localhost" { return true }
        if host.hasSuffix(".local") { return true }
        // Foundation reports a bracketed IPv6 literal's host WITHOUT the
        // brackets (`http://[::1]:8080` -> "::1"), and a ":" can appear in no
        // other host (`URL.host` never carries the port) — so this is the
        // IPv6-literal discriminator, classified by its own loopback-only
        // rule, never by the IPv4/DNS checks.
        if host.contains(":") { return isLoopbackIPv6(host) }
        guard let (a, b, _, _) = ipv4Octets(host) else { return false }
        if a == 127 || a == 10 { return true }
        if a == 192, b == 168 { return true }
        if a == 172 { return b >= 16 && b <= 31 }
        return false
    }
}
