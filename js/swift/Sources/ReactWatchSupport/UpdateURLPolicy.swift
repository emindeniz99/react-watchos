import Foundation

/// OTA transport policy (review §6.11c): update URLs must be https. Plain
/// http is allowed ONLY for the documented dev flow — loopback and
/// private-LAN hosts (the plugin's NSAllowsLocalNetworking scope:
/// localhost/127.*, 10.*, 192.168.*, 172.16-31.*, and mDNS *.local —
/// "your Mac on the LAN"). The Ed25519 signature protects bundle INTEGRITY
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

    private static func isPrivateHost(_ host: String) -> Bool {
        if host == "localhost" { return true }
        if host.hasSuffix(".local") { return true }
        guard let (a, b, _, _) = ipv4Octets(host) else { return false }
        if a == 127 || a == 10 { return true }
        if a == 192, b == 168 { return true }
        if a == 172 { return b >= 16 && b <= 31 }
        return false
    }
}
