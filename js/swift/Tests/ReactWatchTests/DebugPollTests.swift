import Foundation
import ReactWatchRuntime
import XCTest

/// The DEBUG-only debugger transport (docs/design-dap-debugger.md).
///
/// What these prove is the one property the whole design rests on: JS can ask
/// the dev server a question and get the ANSWER BACK IN THE SAME CALL, without
/// returning to the event loop. Nothing else in this runtime can do that —
/// `fetch` settles through a hop onto the owning queue, which a paused
/// debugger is occupying — so if this stopped being synchronous, breakpoints
/// would stop working and no JS-side test would notice.
final class DebugPollTests: XCTestCase {
    #if DEBUG
    func testDebugPollIsAbsentUntilInstalled() throws {
        let runtime = try JSRuntime()
        // The default state, and the one that matters most: an instrumented
        // bundle running with no debugger attached finds no function, marks
        // itself detached, and never polls again.
        XCTAssertTrue(runtime.evaluateBool("typeof __debugPoll === 'undefined'"))
    }

    func testDebugPollReturnsTheHandlerAnswerSynchronously() throws {
        let runtime = try JSRuntime()
        var seen: [String] = []
        runtime.installDebugPoll { state in
            seen.append(state)
            return #"{"v":1,"action":"continue"}"#
        }

        // Note what this expression asserts by its SHAPE: the result is
        // read straight out of the call, not awaited. A promise-based
        // transport would evaluate to "[object Promise]" here.
        let answer = runtime.evaluateString(
            "__debugPoll(JSON.stringify({ v: 1, state: 'running' }))")
        XCTAssertEqual(answer, #"{"v":1,"action":"continue"}"#)
        XCTAssertEqual(seen, [#"{"v":1,"state":"running"}"#])
    }

    func testHandlerSeesEachExchangeInOrder() throws {
        let runtime = try JSRuntime()
        var exchange = 0
        runtime.installDebugPoll { _ in
            exchange += 1
            // Exchange 1 answers "keep waiting"; exchange 2 releases. This
            // is the paused loop's contract: the watch spins on the poll
            // until a command arrives, so the loop must be able to run more
            // than once without the JS thread yielding.
            return exchange < 2 ? #"{"v":1}"# : #"{"v":1,"action":"continue"}"#
        }
        let released = runtime.evaluateBool(
            #"""
            (() => {
              for (let i = 0; i < 10; i++) {
                const answer = JSON.parse(__debugPoll('{"v":1,"state":"paused"}'));
                if (answer.action === 'continue') return true;
              }
              return false;
            })()
            """#)
        XCTAssertTrue(released)
        XCTAssertEqual(exchange, 2)
    }
    #endif
}
