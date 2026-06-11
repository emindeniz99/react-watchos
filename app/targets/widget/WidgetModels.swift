import Foundation

/// Widget-extension copy of the wire schema (kept independent because
/// apple-targets links each target folder to its own target). Mirrors
/// targets/watch/NodeModel.swift plus the published-timelines payload
/// produced by js/src/widgets.ts.
enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case array([JSONValue])
    case object([String: JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let bool = try? container.decode(Bool.self) {
            self = .bool(bool)
        } else if let number = try? container.decode(Double.self) {
            self = .number(number)
        } else if let string = try? container.decode(String.self) {
            self = .string(string)
        } else if let array = try? container.decode([JSONValue].self) {
            self = .array(array)
        } else if let object = try? container.decode([String: JSONValue].self) {
            self = .object(object)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "Unsupported JSON value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

struct RNNode: Codable, Equatable, Identifiable {
    let id: Int
    let type: String
    let props: [String: JSONValue]
    let children: [RNNode]

    func string(_ key: String) -> String? {
        if case .string(let value)? = props[key] { return value }
        return nil
    }

    func double(_ key: String) -> Double? {
        if case .number(let value)? = props[key] { return value }
        return nil
    }

    func bool(_ key: String) -> Bool? {
        if case .bool(let value)? = props[key] { return value }
        return nil
    }
}

struct PublishedEntry: Codable, Equatable {
    /** ms since epoch (JS Date.now()). */
    let date: Double
    let tree: RNNode?

    var entryDate: Date { Date(timeIntervalSince1970: date / 1000) }
}

struct PublishedFamilyTimeline: Codable, Equatable {
    let entries: [PublishedEntry]
    let reloadAfter: Double?

    var reloadAfterDate: Date? {
        reloadAfter.map { Date(timeIntervalSince1970: $0 / 1000) }
    }
}

struct PublishedWidgets: Codable, Equatable {
    let v: Int
    let publishedAt: Double
    let widgets: [String: [String: PublishedFamilyTimeline]]
}

enum WidgetStore {
    static let appGroupId = "group.com.emindeniz99.reactwatch"
    static let payloadKey = "react.widgets.payload"

    static func load() -> PublishedWidgets? {
        guard let json = UserDefaults(suiteName: appGroupId)?
            .string(forKey: payloadKey) else { return nil }
        return try? JSONDecoder().decode(
            PublishedWidgets.self, from: Data(json.utf8))
    }
}
