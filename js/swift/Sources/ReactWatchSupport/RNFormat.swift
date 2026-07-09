import Foundation
import ReactWatchCore

/// Locale-aware date/number formatting for the FormattedText primitive
/// (i18n step 2). QuickJS ships no `Intl` — instead of embedding ICU in the
/// bundle, JS declares the VALUE and the target shape, and native formats it
/// with the device locale (the TimerText "hand native the declarative target"
/// philosophy). This is the single kernel both interpreters call, so app and
/// widget output can't drift (the M6 concern); pure Foundation, so the
/// locale/style matrix is unit-tested on Linux.
public enum RNFormat {
    /// Unpacks a FormattedText node's props — the ONE prop→formatter mapping,
    /// so the app and widget interpreters call this instead of each reading
    /// props themselves.
    public static func text(
        for node: RNNode, locale: Locale = .current, timeZone: TimeZone = .current
    ) -> String {
        text(
            dateMs: node.double("date"),
            dateStyle: node.string("dateStyle"),
            timeStyle: node.string("timeStyle"),
            value: node.double("value"),
            format: node.string("format"),
            currency: node.string("currency"),
            minFractionDigits: node.double("minFractionDigits"),
            maxFractionDigits: node.double("maxFractionDigits"),
            locale: locale, timeZone: timeZone)
    }

    /// Renders a FormattedText node's props to the display string.
    /// `dateMs` (epoch milliseconds) wins over `value` when both are set.
    /// Unknown style strings fall back to their defaults rather than failing
    /// the render (the same forward-compat posture as the interpreters).
    public static func text(
        dateMs: Double?,
        dateStyle: String?,
        timeStyle: String?,
        value: Double?,
        format: String?,
        currency: String?,
        minFractionDigits: Double?,
        maxFractionDigits: Double?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        if let dateMs {
            return date(
                ms: dateMs, dateStyle: dateStyle, timeStyle: timeStyle,
                locale: locale, timeZone: timeZone)
        }
        if let value {
            return number(
                value, format: format, currency: currency,
                minFractionDigits: minFractionDigits,
                maxFractionDigits: maxFractionDigits, locale: locale)
        }
        return ""
    }

    /// DateFormatter/NumberFormatter are among the most expensive Foundation
    /// objects to construct (ICU tables + locale resolution), and FormattedText
    /// re-renders built one per node per SwiftUI body pass — in the app AND the
    /// widget. Cache configured instances by their full configuration. NSCache
    /// is thread-safe (hence `nonisolated(unsafe)` — the cache IS the
    /// synchronization), and formatting through a configured formatter is
    /// thread-safe on every deployed OS (Apple: since iOS 7/macOS 10.9). A
    /// simultaneous miss builds two equivalent instances and one wins — fine.
    nonisolated(unsafe) private static let dateFormatters =
        NSCache<NSString, DateFormatter>()
    nonisolated(unsafe) private static let numberFormatters =
        NSCache<NSString, NumberFormatter>()

    /// Epoch-ms → localized date/time. Defaults: a bare `date` renders
    /// dateStyle "medium" with no time; naming EITHER style switches the
    /// other's default to "none" (so `timeStyle: "short"` alone is just the
    /// clock, not a surprise date prefix).
    public static func date(
        ms: Double,
        dateStyle: String?,
        timeStyle: String?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let resolvedDate = Self.style(
            dateStyle ?? (timeStyle == nil ? "medium" : "none"))
        let resolvedTime = Self.style(timeStyle ?? "none")
        let key =
            "\(locale.identifier)|\(timeZone.identifier)"
            + "|\(resolvedDate.rawValue)|\(resolvedTime.rawValue)" as NSString
        let formatter: DateFormatter
        if let cached = dateFormatters.object(forKey: key) {
            formatter = cached
        } else {
            let built = DateFormatter()
            built.locale = locale
            built.timeZone = timeZone
            built.dateStyle = resolvedDate
            built.timeStyle = resolvedTime
            dateFormatters.setObject(built, forKey: key)
            formatter = built
        }
        return formatter.string(from: Date(timeIntervalSince1970: ms / 1000))
    }

    /// Localized number. `format`: "decimal" (default) | "percent" (0.5 →
    /// "50%", the NumberFormatter/Intl convention) | "currency" (`currency`
    /// selects the ISO code; absent = the locale's own).
    public static func number(
        _ value: Double,
        format: String?,
        currency: String?,
        minFractionDigits: Double?,
        maxFractionDigits: Double?,
        locale: Locale = .current
    ) -> String {
        // clampedInt: a huge/NaN JS value would trap the plain Int() (M3);
        // NumberFormatter itself tolerates any Int but keep digits sane.
        // Resolved BEFORE the cache key so equivalent configs share an entry.
        let minDigits = minFractionDigits.map {
            max(0, min(15, RNStyle.clampedInt($0)))
        }
        let maxDigits = maxFractionDigits.map {
            max(0, min(15, RNStyle.clampedInt($0)))
        }
        let key =
            "\(locale.identifier)|\(format ?? "")|\(currency ?? "")"
            + "|\(minDigits.map(String.init) ?? "")"
            + "|\(maxDigits.map(String.init) ?? "")" as NSString
        let formatter: NumberFormatter
        if let cached = numberFormatters.object(forKey: key) {
            formatter = cached
        } else {
            let built = NumberFormatter()
            built.locale = locale
            switch format {
            case "percent": built.numberStyle = .percent
            case "currency": built.numberStyle = .currency
            default: built.numberStyle = .decimal
            }
            if format == "currency", let currency {
                built.currencyCode = currency
            }
            if let minDigits { built.minimumFractionDigits = minDigits }
            if let maxDigits { built.maximumFractionDigits = maxDigits }
            numberFormatters.setObject(built, forKey: key)
            formatter = built
        }
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    private static func style(_ name: String) -> DateFormatter.Style {
        switch name {
        case "short": .short
        case "medium": .medium
        case "long": .long
        case "full": .full
        default: .none
        }
    }
}
