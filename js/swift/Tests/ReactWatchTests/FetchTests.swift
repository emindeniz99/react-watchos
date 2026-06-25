import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import ReactWatchSupport
import XCTest

final class FetchPlanTests: XCTestCase {
    func testBuildsRequestFromJSON() throws {
        let plan = try XCTUnwrap(FetchPlan(json: #"""
        {"url":"https://example.com/x","method":"POST",
         "headers":{"X-A":"1"},"body":"hello"}
        """#))
        XCTAssertEqual(plan.url, "https://example.com/x")
        XCTAssertEqual(plan.request.url?.absoluteString, "https://example.com/x")
        XCTAssertEqual(plan.request.httpMethod, "POST")
        XCTAssertEqual(plan.request.value(forHTTPHeaderField: "X-A"), "1")
        XCTAssertEqual(plan.request.httpBody, Data("hello".utf8))
    }

    func testNoBodyOrHeaders() throws {
        let plan = try XCTUnwrap(FetchPlan(
            json: #"{"url":"https://example.com","method":"GET"}"#))
        XCTAssertEqual(plan.request.httpMethod, "GET")
        XCTAssertNil(plan.request.httpBody)
    }

    func testRejectsBadInput() {
        XCTAssertNil(FetchPlan(json: "not json"))
        XCTAssertNil(FetchPlan(json: #"{"method":"GET"}"#)) // no url
        XCTAssertNil(FetchPlan(json: #"{"url":"","method":"GET"}"#)) // empty url
    }
}

final class FetchResponseTests: XCTestCase {
    func testAssemblesResponseJSON() throws {
        let json = FetchResponse.json(
            status: 200,
            url: "https://example.com/x",
            body: "ok",
            headers: ["content-type": "text/plain"])
        let obj = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(json.utf8))
                as? [String: Any])
        XCTAssertEqual(obj["status"] as? Int, 200)
        XCTAssertEqual(obj["statusText"] as? String,
                       HTTPURLResponse.localizedString(forStatusCode: 200))
        XCTAssertEqual(obj["url"] as? String, "https://example.com/x")
        XCTAssertEqual(obj["body"] as? String, "ok")
        XCTAssertEqual(obj["bodyEncoding"] as? String, "utf8") // default
        XCTAssertEqual(
            (obj["headers"] as? [String: String])?["content-type"], "text/plain")
    }

    func testBodyEncodingIsCarried() throws {
        let json = FetchResponse.json(
            status: 200, url: "u", body: "AAEC", headers: [:],
            bodyEncoding: "base64")
        let obj = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(json.utf8))
                as? [String: Any])
        XCTAssertEqual(obj["bodyEncoding"] as? String, "base64")
    }
}

// CR-6: the body classifier guards the bridge — UTF-8 text crosses verbatim,
// binary as base64 (never silently ""), and an oversized body is refused so
// the watch's tight QuickJS heap can't be exhausted.
final class FetchBodyTests: XCTestCase {
    func testUTF8BodyIsText() {
        XCTAssertEqual(
            FetchResponse.classifyBody(Data("hello".utf8)), .text("hello"))
    }

    func testNilOrEmptyBodyIsEmptyText() {
        XCTAssertEqual(FetchResponse.classifyBody(nil), .text(""))
        XCTAssertEqual(FetchResponse.classifyBody(Data()), .text(""))
    }

    func testBinaryBodyIsBase64() {
        let bytes = Data([0x00, 0x01, 0x02, 0xFF]) // not valid UTF-8
        XCTAssertEqual(FetchResponse.classifyBody(bytes), .base64("AAEC/w=="))
    }

    func testOversizedBodyIsRejected() {
        let data = Data(count: 11)
        XCTAssertEqual(
            FetchResponse.classifyBody(data, maxBytes: 10),
            .tooLarge(bytes: 11, limit: 10))
    }

    func testBodyAtLimitIsAllowed() {
        // Boundary: exactly at the cap must pass (only `>` is too large).
        XCTAssertEqual(
            FetchResponse.classifyBody(Data("aaaaa".utf8), maxBytes: 5),
            .text("aaaaa"))
    }
}
