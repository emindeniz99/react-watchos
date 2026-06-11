import Foundation

/// Mirror of the JS wire schema (js/src/host.ts). Changing either side is
/// a breaking change for the other.
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

    func stringArray(_ key: String) -> [String]? {
        guard case .array(let values)? = props[key] else { return nil }
        return values.compactMap {
            if case .string(let value) = $0 { return value }
            return nil
        }
    }
}

struct RNTree: Codable, Equatable {
    let v: Int
    /// Ack of the highest dispatched event seq (see ReactAppModel.dispatch).
    let seq: Int?
    let root: RNNode?
}
