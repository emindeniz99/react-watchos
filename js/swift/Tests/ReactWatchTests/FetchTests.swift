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
        XCTAssertEqual(
            (obj["headers"] as? [String: String])?["content-type"], "text/plain")
    }
}
