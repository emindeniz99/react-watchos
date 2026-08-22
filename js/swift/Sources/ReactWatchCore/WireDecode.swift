import Foundation

#if canImport(Darwin)
import CoreFoundation
#endif

// The committed-tree decoder for the per-commit hot path. Hand-written
// companion to the codegen'd WireModel.swift (its field names mirror
// codegen/schema.ts `node` + RNTree; WireContractTests/WireDecodeTests catch
// drift): JSONSerialization + a direct RNTree/RNNode/JSONValue builder,
// because Codable's `JSONValue.init(from:)` pays a thrown-and-dropped
// `DecodingError` per non-bool scalar (a try? cascade over a single-value
// container) and that cascade — not the wire shape — is where the native
// commit cost went: 10.3 vs 5.5ms per 595-node commit on the treediff-large
// fixture (docs/perf-tree-diff.md §4+§8). Building the wire
// models directly (not JSONValue first and Codable after) is the shape that
// was measured; a JSONValue-only bridge would re-enter the cascade.
//
// The semantics are pinned to what `JSONDecoder` + the Codable conformances
// did — the decode tests and fixtures are the spec, and WireDecodeTests
// asserts agreement (same tree or both fail) case by case. The traps and how
// each is handled:
//
//  - bool vs number: JSONSerialization hands every scalar back as NSNumber
//    (Darwin always; swift-corelibs too, as __NSCFBoolean/NSNumber). JSON
//    true/false must become `.bool` and numeric 0/1 must stay `.number`, so
//    the discriminator is the NUMBER'S TYPE, never its value — see
//    `isJSONBoolean`. `as? Bool` is unusable: corelibs bridges NSNumber(0)/
//    NSNumber(1) to false/true.
//  - every number decodes as Double (`.doubleValue`), exactly like the
//    Codable path's `decode(Double.self)` — including int64-range integers
//    (rounded the same way) and JSONSerialization's NSDecimalNumber.
//  - Int fields (v/seq/id): `as? Int` plus a boolean rejection and an
//    exactness round-trip, so `1`/`1.0` decode and `true`/`1.5`/clamped
//    decimals fail — Codable's Int behavior (see `wireInt`).
//  - null vs absent: an absent or null `root` is nil (Codable optional);
//    a null PROP VALUE stays `.null` under its key (Codable kept it).
//  - strictness: a missing/mistyped required key (id/type/props/children,
//    v/seq) or a malformed child fails the WHOLE decode — nothing is
//    defaulted or dropped, because the Codable path threw there and a
//    half-decoded commit must report commit.decodeFailed, not render.
//  - lone surrogates, numbers beyond Double, >512-deep nesting: rejected by
//    JSONSerialization's parser just as JSONDecoder's rejected them
//    (verified on this toolchain; both fail, so parity holds). The parse
//    depth cap also bounds the builder's recursion.

private struct WireDecodeError: Error, CustomStringConvertible {
    let description: String
}

/// Whether a JSONSerialization-produced NSNumber is a JSON true/false, as
/// opposed to a number that merely equals 0 or 1. Type check, never value.
private func isJSONBoolean(_ number: NSNumber) -> Bool {
    #if canImport(Darwin)
    // CFBoolean is its own CF type; every numeric NSNumber is CFNumber.
    return CFGetTypeID(number) == CFBooleanGetTypeID()
    #else
    // corelibs materializes true/false as __NSCFBoolean — the only NSNumber
    // its JSONSerialization creates whose objCType is "c".
    let objCType = number.objCType
    return objCType.pointee == CChar(bitPattern: UInt8(ascii: "c"))
        && objCType.advanced(by: 1).pointee == 0
    #endif
}

/// An Int field (v/seq/id) with Codable's semantics: `1` and `1.0` decode;
/// `true` and `1.5` fail; so do beyond-Int64 integers, which both parsers
/// hand back as NSDecimalNumber and corelibs would silently CLAMP under a
/// bare `as? Int` (its cross-type `==` then blesses the clamp, so the
/// round-trip check alone can't catch it). nil = absent or not an Int.
private func wireInt(_ any: Any?) -> Int? {
    guard let number = any as? NSNumber, !isJSONBoolean(number),
        !(number is NSDecimalNumber),
        let int = number as? Int, NSNumber(value: int) == number
    else { return nil }
    return int
}

extension JSONValue {
    /// Rebuilds a JSONSerialization object-graph value. Throws only for a
    /// type JSONSerialization cannot emit — same terminal case the Codable
    /// cascade's final `else` covered.
    init(fromJSONObject any: Any) throws {
        if let string = any as? String {
            self = .string(string)
        } else if let number = any as? NSNumber {
            self = isJSONBoolean(number) ? .bool(number.boolValue) : .number(number.doubleValue)
        } else if let array = any as? [Any] {
            self = .array(try array.map { try JSONValue(fromJSONObject: $0) })
        } else if let object = any as? [String: Any] {
            self = .object(try object.mapValues { try JSONValue(fromJSONObject: $0) })
        } else if any is NSNull {
            self = .null
        } else {
            throw WireDecodeError(description: "unsupported JSON value: \(type(of: any))")
        }
    }
}

extension RNNode {
    /// A node object: id/type/props/children all required and typed, extra
    /// keys ignored — the synthesized Codable init's behavior.
    init(fromJSONObject any: Any) throws {
        guard let dict = any as? [String: Any] else {
            throw WireDecodeError(description: "node is not an object")
        }
        guard let id = wireInt(dict["id"]) else {
            throw WireDecodeError(description: "node id missing or not an Int")
        }
        guard let type = dict["type"] as? String else {
            throw WireDecodeError(description: "node type missing or not a String")
        }
        guard let props = dict["props"] as? [String: Any] else {
            throw WireDecodeError(description: "node props missing or not an object")
        }
        guard let children = dict["children"] as? [Any] else {
            throw WireDecodeError(description: "node children missing or not an array")
        }
        self.init(
            id: id, type: type,
            props: try props.mapValues { try JSONValue(fromJSONObject: $0) },
            children: try children.map { try RNNode(fromJSONObject: $0) })
    }
}

extension RNTree {
    /// Decodes one committed tree from the wire payload — the entry point the
    /// host's per-commit path calls instead of `JSONDecoder` (~2x cheaper on
    /// a big commit; the conformance-driven decode remains for the cold
    /// paths, see WireModel.swift). Throws on anything the Codable decode
    /// would have thrown on.
    public init(wireJSON data: Data) throws {
        let raw = try JSONSerialization.jsonObject(with: data)
        guard let dict = raw as? [String: Any] else {
            throw WireDecodeError(description: "commit payload is not an object")
        }
        guard let v = wireInt(dict["v"]), let seq = wireInt(dict["seq"]) else {
            throw WireDecodeError(description: "commit v/seq missing or not an Int")
        }
        let root: RNNode?
        if let rawRoot = dict["root"] {
            // Try the object cast FIRST and reach `is NSNull` only when the
            // root is genuinely not an object (a null-root commit, where the
            // decode cost is moot). Order is a measured 2.3x, not style: on
            // corelibs, executing a class check against the root container
            // before the build flips every value the parser handed back into
            // its NSObject representation, and the whole walk then pays an
            // eager NSString->String bridge copy per string cast — 10.9ms vs
            // 4.5ms on the treediff-large fixture, i.e. it silently erased
            // this decoder's entire win over Codable.
            if let rootDict = rawRoot as? [String: Any] {
                root = try RNNode(fromJSONObject: rootDict)
            } else if rawRoot is NSNull {
                root = nil
            } else {
                throw WireDecodeError(description: "commit root is neither an object nor null")
            }
        } else {
            root = nil
        }
        self.init(v: v, seq: seq, root: root)
    }
}
