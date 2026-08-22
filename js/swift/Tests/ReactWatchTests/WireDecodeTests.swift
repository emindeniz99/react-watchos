import Foundation
import ReactWatchCore
import XCTest

/// Pins `RNTree(wireJSON:)` — the JSONSerialization-based decoder the host's
/// per-commit path uses — to the semantics of the Codable decode it replaced
/// (`JSONDecoder` + `JSONValue.init(from:)`, still shipped for the cold
/// paths). Two layers:
///
///  1. real serializer output: every tree fixture must decode IDENTICALLY
///     through both decoders — tree.json and kitchen-sink.json carry both
///     genuine booleans and numeric 0/1 props, so the bool-vs-number
///     disambiguation is pinned against payloads JS actually produces (the
///     treediff fixtures alone could not catch a 0/1→bool drift: they
///     contain no bare 0/1 prop values);
///  2. adversarial payloads: for each edge case the two decoders must agree
///     — same tree, or BOTH refuse. That includes the traps called out in
///     WireDecode.swift: true vs 1, Int-field exactness (1.0 yes, 1.5/true/
///     beyond-Int64 no), null vs absent root, null prop values kept, missing
///     required keys, malformed children, lone surrogates, numbers beyond
///     Double, and the parser depth cap.
final class WireDecodeTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(
                forResource: name, withExtension: "json", subdirectory: "Fixtures"
            ),
            "missing fixture \(name).json"
        )
        return try Data(contentsOf: url)
    }

    /// Both decoders on the same bytes: equal trees, or both throwing.
    private func assertParity(
        _ data: Data, _ label: String, file: StaticString = #filePath, line: UInt = #line
    ) {
        let codable = try? JSONDecoder().decode(RNTree.self, from: data)
        let wire = try? RNTree(wireJSON: data)
        switch (codable, wire) {
        case (nil, nil):
            break  // both refused — parity
        case (let codable?, let wire?):
            XCTAssertEqual(codable, wire, "decoders disagree on \(label)", file: file, line: line)
        case (nil, .some):
            XCTFail("wire decoder accepted what Codable refused: \(label)", file: file, line: line)
        case (.some, nil):
            XCTFail("wire decoder refused what Codable accepted: \(label)", file: file, line: line)
        }
    }

    func testTreeFixturesDecodeIdenticallyThroughBothDecoders() throws {
        for name in [
            "tree", "kitchen-sink",
            "treediff-small-before", "treediff-small-after",
            "treediff-large-before", "treediff-large-after",
        ] {
            let data = try fixture(name)
            let codable = try JSONDecoder().decode(RNTree.self, from: data)
            let wire = try RNTree(wireJSON: data)
            XCTAssertEqual(codable, wire, "decoders disagree on \(name).json")
            XCTAssertNotNil(wire.root, "\(name).json decoded to an empty tree")
        }
    }

    func testBoolVsNumberDisambiguation() throws {
        // The one trap that silently renders wrong instead of failing loud:
        // JSONSerialization hands scalars back as NSNumber, where 1 and true
        // are separable only by the number's TYPE. Pinned by value here, not
        // just by parity, so a regression names the case.
        let json = """
            {"v": 1, "seq": 0, "root": {"id": 1, "type": "T",
             "props": {"t": true, "f": false, "one": 1, "zero": 0, "half": 0.5},
             "children": []}}
            """
        let root = try XCTUnwrap(try RNTree(wireJSON: Data(json.utf8)).root)
        XCTAssertEqual(root.props["t"], .bool(true))
        XCTAssertEqual(root.props["f"], .bool(false))
        XCTAssertEqual(root.props["one"], .number(1))
        XCTAssertEqual(root.props["zero"], .number(0))
        XCTAssertEqual(root.props["half"], .number(0.5))
    }

    func testNullAndAbsentRootBothDecodeToNil() throws {
        XCTAssertNil(try RNTree(wireJSON: Data(#"{"v":1,"seq":3,"root":null}"#.utf8)).root)
        XCTAssertNil(try RNTree(wireJSON: Data(#"{"v":1,"seq":3}"#.utf8)).root)
        // …while a null PROP survives under its key, exactly like Codable.
        let json = #"{"v":1,"seq":0,"root":{"id":1,"type":"T","props":{"a":null},"children":[]}}"#
        let root = try XCTUnwrap(try RNTree(wireJSON: Data(json.utf8)).root)
        XCTAssertEqual(root.props["a"], .null)
    }

    /// A one-node tree whose root carries `props` (a JSON object literal).
    private func propsPayload(_ props: String) -> String {
        #"{"v":1,"seq":0,"root":{"id":1,"type":"T","props":"# + props
            + #","children":[]}}"#
    }

    func testEdgeCasePayloadsAgreeWithCodable() {
        let cases: [(String, String)] = [
            // Int-field semantics: 1.0 decodes, 1.5/true/string/absent fail.
            ("float v", #"{"v":1.0,"seq":0,"root":null}"#),
            ("fractional v", #"{"v":1.5,"seq":0,"root":null}"#),
            ("boolean v", #"{"v":true,"seq":0,"root":null}"#),
            ("string seq", #"{"v":1,"seq":"0","root":null}"#),
            ("missing seq", #"{"v":1,"root":null}"#),
            ("beyond-Int64 seq", #"{"v":1,"seq":-9223372036854775809,"root":null}"#),
            (
                "boolean id",
                #"{"v":1,"seq":0,"root":{"id":true,"type":"T","props":{},"children":[]}}"#
            ),
            // Structural strictness: wrong-typed/missing pieces refuse whole.
            ("numeric root", #"{"v":1,"seq":0,"root":5}"#),
            ("array payload", #"[1,2]"#),
            ("missing props", #"{"v":1,"seq":0,"root":{"id":1,"type":"T","children":[]}}"#),
            ("null props", propsPayload("null")),
            ("missing children", #"{"v":1,"seq":0,"root":{"id":1,"type":"T","props":{}}}"#),
            (
                "malformed child",
                #"{"v":1,"seq":0,"root":{"id":1,"type":"T","props":{},"children":[7]}}"#
            ),
            ("extra keys ignored", #"{"v":1,"seq":0,"root":null,"extra":[1]}"#),
            // Number edges: every number is a Double, same rounding, same
            // refusals (1e400 exceeds Double; the huge ints round like
            // Codable's decode(Double.self) did).
            (
                "number menagerie",
                propsPayload(
                    #"{"neg":-0.0,"big":9007199254740993,"# + #""huge":18446744073709551615,"#
                        + #""exp":1e308,"s":"1","nested":[1,true,"x",null]}"#)
            ),
            ("beyond-Double prop", propsPayload(#"{"a":1e400}"#)),
            // String edges: astral pairs survive; a lone surrogate is refused
            // by both parsers on this toolchain.
            ("astral pair", propsPayload(#"{"a":"😀"}"#)),
            ("lone surrogate", propsPayload(#"{"a":"\ud800"}"#)),
        ]
        for (label, json) in cases {
            assertParity(Data(json.utf8), label)
        }
    }

    func testNestingDepthCapMatchesCodable() {
        // Both parsers cap at the same depth (512 on this Foundation); the
        // exact boundary is theirs to own — what this pins is agreement well
        // inside and well outside it, and that the cap also bounds the
        // builder's recursion.
        for depth in [400, 600] {
            let array =
                String(repeating: "[", count: depth)
                + String(repeating: "]", count: depth)
            let json =
                #"{"v":1,"seq":0,"root":{"id":1,"type":"T","props":{"a":"#
                + array + #"},"children":[]}}"#
            assertParity(Data(json.utf8), "depth \(depth)")
        }
    }
}
