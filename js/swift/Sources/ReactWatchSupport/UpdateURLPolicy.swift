import Foundation

/// OTA transport policy (review §6.11c): update URLs must be https. Plain
/// http is allowed ONLY for the documented dev flow — loopback and
/// private-LAN hosts (the plugin's NSAllowsLocalNetworking scope:
/// localhost/127.*/[::1], 10.*, 192.168.*, 172.16-31.*, and mDNS *.local —
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

    private static func isPrivateHost(_ host: String) -> Bool {
        if host == "localhost" || host == "::1" { return true }
        if host.hasSuffix(".local") { return true }
        if host.hasPrefix("127.") || host.hasPrefix("10.")
            || host.hasPrefix("192.168.")
        {
            return true
        }
        // 172.16.0.0/12: second octet 16–31.
        let parts = host.split(separator: ".")
        if parts.count >= 2, parts[0] == "172", let second = Int(parts[1]) {
            return second >= 16 && second <= 31
        }
        return false
    }
}
