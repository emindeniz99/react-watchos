import Foundation
import ReactWatchCore

/// Pure, SwiftUI-free parsing of the styling props shared by the app interpreter
/// (NodeView) and the widget interpreter (WidgetNodeView). Keeping this in one
/// place — and on Linux-testable Foundation — is what stops the two interpreters
/// from drifting (CX-018: the widget had lost hex colors and monospaced digits).
/// Each interpreter maps these *values* to its SwiftUI types; the logic is here.
public enum RNStyle {
    /// A resolved color prop: a known system-color name the interpreter maps to
    /// `Color.<name>`, or parsed `#RGB[A]` components.
    public enum Color: Equatable, Sendable {
        case named(String)
        case rgba(r: Double, g: Double, b: Double, a: Double)
    }

    /// The system color names both interpreters understand (mapped to SwiftUI
    /// `Color` per side). Shared so the set can't drift.
    public static let namedColors: Set<String> = [
        "red", "orange", "yellow", "green", "mint", "teal", "cyan", "blue",
        "indigo", "purple", "pink", "brown", "white", "gray", "black",
        "primary", "secondary",
    ]

    /// Resolves a `color` prop: a known name, or `#RRGGBB`/`#RRGGBBAA` hex.
    /// nil for anything else (the interpreter falls back to `.primary`).
    public static func color(_ name: String?) -> Color? {
        guard let name else { return nil }
        if namedColors.contains(name) { return .named(name) }
        guard let hex = hexRGBA(name) else { return nil }
        return .rgba(r: hex.r, g: hex.g, b: hex.b, a: hex.a)
    }

    /// Parses `#RRGGBB` or `#RRGGBBAA` into 0...1 components; nil otherwise.
    public static func hexRGBA(
        _ string: String
    ) -> (r: Double, g: Double, b: Double, a: Double)? {
        guard string.hasPrefix("#") else { return nil }
        let hex = string.dropFirst()
        guard hex.allSatisfy(\.isHexDigit), let bits = UInt32(hex, radix: 16)
        else { return nil }
        func channel(_ shift: UInt32) -> Double {
            Double((bits >> shift) & 0xFF) / 255
        }
        switch hex.count {
        case 6: return (channel(16), channel(8), channel(0), 1)
        case 8: return (channel(24), channel(16), channel(8), channel(0))
        default: return nil
        }
    }

    /// Semantic Dynamic Type styles (js TextProps.textStyle); unknown -> body.
    public enum FontStyle: String, Sendable, CaseIterable {
        case largeTitle, title, title2, title3, headline, callout
        case subheadline, footnote, caption, body
    }

    public static func fontStyle(_ name: String?) -> FontStyle {
        guard let name, let style = FontStyle(rawValue: name) else { return .body }
        return style
    }

    /// Gauge/value label: integers print without a decimal, else one place.
    public static func formatValue(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(value)) : String(format: "%.1f", value)
    }

    /// mm:ss.SSS for the millisecond TimerText mode (shared so the widget can
    /// match the app instead of silently ignoring `milliseconds`).
    public static func formatTimer(_ interval: TimeInterval) -> String {
        let totalMs = Int((interval * 1000).rounded(.down))
        let minutes = totalMs / 60000
        let seconds = (totalMs / 1000) % 60
        let millis = totalMs % 1000
        return String(format: "%02d:%02d.%03d", minutes, seconds, millis)
    }
}

// MARK: - Layout modifiers (design-system Tier 1)

extension RNStyle {
    /// Parsed `padding` prop: a scalar (`padding={8}`) applies to all edges;
    /// an object (`padding={{horizontal: 8, vertical: 2}}`) per axis.
    public struct Insets: Equatable, Sendable {
        public let all: Double?
        public let horizontal: Double?
        public let vertical: Double?

        public init(all: Double? = nil, horizontal: Double? = nil, vertical: Double? = nil) {
            self.all = all
            self.horizontal = horizontal
            self.vertical = vertical
        }
    }

    public static func padding(from value: JSONValue?) -> Insets? {
        switch value {
        case .number(let n):
            return Insets(all: n)
        case .object(let fields):
            let h = fields["horizontal"].flatMap(Self.number)
            let v = fields["vertical"].flatMap(Self.number)
            if h == nil && v == nil { return nil }
            return Insets(horizontal: h, vertical: v)
        default:
            return nil
        }
    }

    /// Parsed `frame` prop. `maxWidth`/`maxHeight` accept the string
    /// `"infinity"` (SwiftUI's `.frame(maxWidth: .infinity)` fill idiom).
    public struct Frame: Equatable, Sendable {
        public let width: Double?
        public let height: Double?
        public let maxWidth: Double?
        public let maxHeight: Double?
        public let maxWidthInfinity: Bool
        public let maxHeightInfinity: Bool

        public init(
            width: Double? = nil, height: Double? = nil,
            maxWidth: Double? = nil, maxHeight: Double? = nil,
            maxWidthInfinity: Bool = false, maxHeightInfinity: Bool = false
        ) {
            self.width = width
            self.height = height
            self.maxWidth = maxWidth
            self.maxHeight = maxHeight
            self.maxWidthInfinity = maxWidthInfinity
            self.maxHeightInfinity = maxHeightInfinity
        }

        public var isEmpty: Bool {
            width == nil && height == nil && maxWidth == nil && maxHeight == nil
                && !maxWidthInfinity && !maxHeightInfinity
        }
    }

    public static func frame(from value: JSONValue?) -> Frame? {
        guard case .object(let fields)? = value else { return nil }
        let frame = Frame(
            width: fields["width"].flatMap(Self.number),
            height: fields["height"].flatMap(Self.number),
            maxWidth: fields["maxWidth"].flatMap(Self.number),
            maxHeight: fields["maxHeight"].flatMap(Self.number),
            maxWidthInfinity: fields["maxWidth"] == .string("infinity"),
            maxHeightInfinity: fields["maxHeight"] == .string("infinity")
        )
        return frame.isEmpty ? nil : frame
    }

    private static func number(_ value: JSONValue) -> Double? {
        if case .number(let n) = value { return n }
        return nil
    }
}
