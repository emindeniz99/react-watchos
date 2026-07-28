import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchRoute } from "../src/navigation";

/**
 * The route matcher is implemented TWICE — `matchRoute` in
 * js/src/navigation.tsx (what `useParams()` resolves) and `RouteMatcher` in
 * swift/Sources/ReactWatchSupport/RouteMatcher.swift (what the host renders a
 * destination from). They must agree on every route, or a deep link renders one
 * screen with another screen's params. Until now each side had its own
 * hand-written tests, which is precisely the arrangement that lets two
 * implementations drift while both stay green.
 *
 * So: the same contract-fixture harness the wire and invoke channels use. This
 * test runs the REAL `matchRoute` over a case table and writes its actual
 * output to `Fixtures/route-cases.json`; `RouteMatcherConformanceTests` in
 * SupportTests.swift decodes that file and asserts `RouteMatcher.match`
 * produces the same params and the same specificity score for every case.
 * Neither side can move without the other failing.
 *
 * Params are normalized to `[string]` here: a `[id]` capture is a bare string
 * in JS and a one-element array in Swift (`[String: [String]]`), which is a
 * representation difference, not a behavioral one. Everything else — which
 * routes match, what each param captures, the score — is compared verbatim.
 *
 * NOT covered here: the best-of-N tie-break (`bestOf` in navigation.tsx vs
 * `RouteMatcher.best`), which is module-private on the JS side and stays on
 * hand-written tests in both languages.
 */

const fixturesDir = join(__dirname, "../swift/Tests/ReactWatchTests/Fixtures");

/**
 * Pattern/route pairs spanning the matchers' whole declared feature set:
 * literals, `[param]`, `[...catchAll]`, `[[...optionalCatchAll]]`, segment
 * splitting, and percent-decoding — each with its matching AND its
 * non-matching side, since "returns null when it should" is half the contract.
 *
 * The UNNAMED bracket forms `[]`, `[...]` and `[[...]]` were an open divergence
 * (Swift's prefix/suffix parse accepted an empty name and made them a
 * param/catch-all called ""), aligned on 2026-07-28: JS is the authority — its
 * anchored `(.+)` regexes need a non-empty name, and Next.js, the syntax this
 * mirrors, rejects unnamed segments at build time — so Swift now falls through
 * the same way and the cases below are pinned here like any other.
 */
const CASES: readonly (readonly [pattern: string, route: string])[] = [
  // --- literals + segment splitting
  ["/lists", "/lists"],
  ["/lists", "/list"],
  ["/lists", "/lists/1"],
  ["/lists", "/"],
  ["/Lists", "/lists"],
  ["/", "/"],
  ["", ""],
  ["/", "/a"],
  ["/a/b", "/a/b"],
  ["/a/b", "/a"],
  ["/a/b", "/a/b/"],
  ["/a/b", "//a//b//"],
  ["//a//b//", "/a/b"],
  // --- single params
  ["/list/[id]", "/list/42"],
  ["/list/[id]", "/list"],
  ["/list/[id]", "/list/42/items"],
  ["/list/[id]/edit", "/list/42/edit"],
  ["/list/[id]/edit", "/list/42/delete"],
  ["/[a]/[b]", "/x/y"],
  // A name the JS side reaches by a greedy regex and the Swift side by
  // dropFirst/dropLast — the two must still produce the same param name.
  ["/[a][b]", "/x"],
  // --- required catch-all (>= 1 segment)
  ["/shop/[...rest]", "/shop/a"],
  ["/shop/[...rest]", "/shop/a/b/c"],
  ["/shop/[...rest]", "/shop"],
  ["/[...all]", "/a/b"],
  ["/[...all]", "/"],
  ["/shop/[name]/[...rest]", "/shop/nike/a/b"],
  ["/shop/[name]/[...rest]", "/shop/nike"],
  // --- optional catch-all (>= 0 segments)
  ["/shop/[[...rest]]", "/shop"],
  ["/shop/[[...rest]]", "/shop/a/b"],
  ["/[[...all]]", "/"],
  ["/shop/[name]/[[...rest]]", "/shop/nike"],
  ["/shop/[name]/[[...rest]]", "/shop/nike/shoes/running"],
  ["/shop/[name]/[[...rest]]", "/shop"],
  // A trailing `x` makes it none of the three bracket forms in both parsers.
  ["/[[...rest]]x", "/[[...rest]]x"],
  ["/[[...rest]]x", "/y"],
  // Both matchers return AT the catch-all, so pattern segments after it are
  // unreachable. Shared quirk — pinned so it can't become a one-sided fix.
  ["/a/[...rest]/b", "/a/x/y"],
  // --- percent-decoding (href() encodes params; both sides decode captures)
  ["/list/[id]", "/list/a%2Fb%20100%25"],
  ["/shop/[name]/[...rest]", "/shop/caf%C3%A9/a%2Fb/c"],
  ["/café/[id]", "/caf%C3%A9/7"],
  ["/café/[id]", "/café/7"],
  ["/café/[id]", "/tea/7"],
  ["/a b/[id]", "/a%20b/7"],
  // Malformed escapes fall back to the raw segment on both sides, never throw.
  ["/list/[id]", "/list/a%zz"],
  ["/list/[id]", "/list/%FF"],
  ["/list/[id]", "/list/100%"],
  // "+" is not a space in a path segment — neither decoder may touch it.
  ["/list/[id]", "/list/a+b"],
  // --- unnamed bracket forms: never a wildcard on either side (2026-07-28)
  // A capture with no name to read it back under isn't one. `[]` is a literal
  // here, `[...]` a param named "...", `[[...]]` a param named "[...]" — so
  // none of these routes matches, where Swift used to match all of them with
  // an empty param name.
  ["/[]", "/x"],
  ["/[...]", "/a/b"],
  ["/[[...]]", "/"],
  ["/[[...]]", "/a/b"],
  // ...and the fall-through itself: `[]` matches the LITERAL "[]", `[...]`
  // captures under the name "...". Without these the four rejections above
  // hold for a matcher that simply refuses every unnamed form, so the fixture
  // could not tell the shared fall-through from a one-sided blanket reject.
  ["/[]", "/[]"],
  ["/[...]", "/a"],
  ["/[[...]]", "/a"],
];

interface FixtureCase {
  pattern: string;
  route: string;
  /** null = the matcher rejects this route for this pattern. */
  match: { params: Record<string, string[]>; score: number } | null;
}

describe("route matcher cross-language conformance", () => {
  it("writes what the real matchRoute returns for every case", () => {
    const cases: FixtureCase[] = CASES.map(([pattern, route]) => {
      const result = matchRoute(pattern, route);
      return {
        pattern,
        route,
        match:
          result === null
            ? null
            : {
                params: Object.fromEntries(
                  Object.entries(result.params).map(([name, value]) => [
                    name,
                    typeof value === "string" ? [value] : value,
                  ]),
                ),
                score: result.score,
              },
      };
    });

    // Non-vacuity: a table that matched everything (or nothing) would let a
    // Swift matcher that always returns nil pass the conformance test.
    expect(cases.filter((c) => c.match !== null).length).toBeGreaterThan(20);
    expect(cases.filter((c) => c.match === null).length).toBeGreaterThan(8);
    expect(
      cases.filter((c) => Object.keys(c.match?.params ?? {}).length > 0).length,
    ).toBeGreaterThan(15);

    mkdirSync(fixturesDir, { recursive: true });
    writeFileSync(
      join(fixturesDir, "route-cases.json"),
      `${JSON.stringify({ cases }, null, 2)}\n`,
    );
  });
});
