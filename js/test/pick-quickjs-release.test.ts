import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formatAge,
  pickRelease,
  renderProposal,
  renderReport,
  type UpstreamRelease,
  vendoredTagFromHeader,
} from "../scripts/pick-quickjs-release.ts";

// The engine bump bot's waiting policy. This is the part of the bot worth
// testing: opening a PR is plumbing, but choosing WHICH release to propose is a
// judgement encoded in code, and every case below is one somebody would
// otherwise have to remember at 3am.
const NOW = new Date("2026-08-21T00:00:00Z");
const daysAgo = (days: number): string =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

const release = (
  tag: string,
  days: number,
  extra: Partial<UpstreamRelease> = {},
): UpstreamRelease => ({
  tag_name: tag,
  published_at: daysAgo(days),
  html_url: `https://github.com/quickjs-ng/quickjs/releases/tag/${tag}`,
  ...extra,
});

describe("pickRelease", () => {
  it("proposes the newest release once it has soaked", () => {
    const pick = pickRelease([release("v0.17.0", 10), release("v0.16.1", 60)], {
      vendoredTag: "v0.16.1",
      now: NOW,
    });
    expect(pick.action).toBe("propose");
    expect(pick.candidate?.tag_name).toBe("v0.17.0");
    expect(pick.soaking).toEqual([]);
  });

  // THE case the policy exists for. v0.17.0 is 10 days old and would look
  // perfectly proposable on its own; v0.17.1 landing two days ago is the signal
  // that v0.17.0 had something wrong with it. The bot still proposes (a human
  // decides), but the PR must carry the warning — a silent proposal here is how
  // you vendor the broken one on day seven.
  it("keeps the soaked candidate but reports the fresh hotfix above it", () => {
    const pick = pickRelease(
      [release("v0.17.1", 2), release("v0.17.0", 10), release("v0.16.1", 60)],
      { vendoredTag: "v0.16.1", now: NOW },
    );
    expect(pick.action).toBe("propose");
    expect(pick.candidate?.tag_name).toBe("v0.17.0");
    expect(pick.soaking.map((r) => r.tag_name)).toEqual(["v0.17.1"]);

    const body = renderProposal(pick, {
      vendoredTag: "v0.16.1",
      soakDays: 7,
      sha256: "abc",
      now: NOW,
    });
    expect(body).toContain("[!WARNING]");
    expect(body).toContain("v0.17.1");
  });

  it("does nothing while every release is younger than the soak window", () => {
    const pick = pickRelease([release("v0.17.0", 3), release("v0.16.1", 1)], {
      vendoredTag: "v0.16.1",
      now: NOW,
    });
    expect(pick.action).toBe("none");
    expect(pick.reason).toContain("soaked");
  });

  it("does nothing when the vendored release is the soaked candidate", () => {
    const pick = pickRelease([release("v0.16.1", 60)], {
      vendoredTag: "v0.16.1",
      now: NOW,
    });
    expect(pick.action).toBe("none");
    expect(pick.reason).toContain("already on");
  });

  // A human who vendored a fresh release deliberately (a security fix, say)
  // must not be handed a PR walking it back to the older soaked one the next
  // morning.
  it("never proposes a downgrade", () => {
    const pick = pickRelease([release("v0.17.1", 2), release("v0.17.0", 10)], {
      vendoredTag: "v0.17.1",
      now: NOW,
    });
    expect(pick.action).toBe("none");
    expect(pick.reason).toContain("newer than the soaked candidate");
  });

  it("ignores drafts and prereleases entirely", () => {
    const pick = pickRelease(
      [
        release("v0.18.0-rc1", 30, { prerelease: true }),
        release("v0.18.0-draft", 30, { draft: true, published_at: null }),
        release("v0.17.0", 10),
        release("v0.16.1", 60),
      ],
      { vendoredTag: "v0.16.1", now: NOW },
    );
    expect(pick.candidate?.tag_name).toBe("v0.17.0");
    expect(pick.behind.map((r) => r.tag_name)).toEqual(["v0.17.0"]);
  });

  it("skips a tag marked known-bad and takes the next one down", () => {
    const pick = pickRelease(
      [release("v0.17.1", 8), release("v0.17.0", 20), release("v0.16.1", 60)],
      { vendoredTag: "v0.16.1", now: NOW, skip: ["v0.17.1"] },
    );
    expect(pick.candidate?.tag_name).toBe("v0.17.0");
    expect(pick.skipped.map((r) => r.tag_name)).toEqual(["v0.17.1"]);
  });

  // Off-by-one at the boundary decides whether the bot fires a day early, which
  // is the whole point of having a window.
  it("treats the soak window as inclusive at exactly N days", () => {
    const releases = [release("v0.17.0", 7), release("v0.16.1", 60)];
    expect(
      pickRelease(releases, { vendoredTag: "v0.16.1", now: NOW }).action,
    ).toBe("propose");
    expect(
      pickRelease([release("v0.17.0", 6.9), release("v0.16.1", 60)], {
        vendoredTag: "v0.16.1",
        now: NOW,
      }).action,
    ).toBe("none");
  });

  it("lists every release in between, oldest first", () => {
    const pick = pickRelease(
      [
        release("v0.19.0", 8),
        release("v0.18.0", 30),
        release("v0.17.0", 50),
        release("v0.16.1", 90),
      ],
      { vendoredTag: "v0.16.1", now: NOW },
    );
    expect(pick.candidate?.tag_name).toBe("v0.19.0");
    expect(pick.behind.map((r) => r.tag_name)).toEqual([
      "v0.17.0",
      "v0.18.0",
      "v0.19.0",
    ]);
  });
});

describe("vendoredTagFromHeader", () => {
  // Reads the ACTUAL vendored header, so a re-vendor that changes the macro
  // shape breaks this instead of silently making the bot propose a bump to the
  // version it already has.
  it("reports the version the repo actually vendors", () => {
    const header = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../swift/Sources/CQuickJS/include/quickjs.h",
      ),
      "utf8",
    );
    expect(vendoredTagFromHeader(header)).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it("parses major/minor/patch and an optional suffix", () => {
    expect(
      vendoredTagFromHeader(
        "#define QJS_VERSION_MAJOR 0\n#define QJS_VERSION_MINOR 16\n#define QJS_VERSION_PATCH 1\n",
      ),
    ).toBe("v0.16.1");
    expect(
      vendoredTagFromHeader(
        '#define QJS_VERSION_MAJOR 1\n#define QJS_VERSION_MINOR 0\n#define QJS_VERSION_PATCH 0\n#define QJS_VERSION_SUFFIX "-rc1"\n',
      ),
    ).toBe("v1.0.0-rc1");
  });
});

// A scheduled job that decides to do nothing has to show its work — the first
// real run was twelve green seconds of "skipped" steps that said nothing about
// what upstream had published or why it was refused. Every release the API
// returns must appear with a verdict, including the ones that were never
// candidates.
describe("the decision report", () => {
  const REAL_WORLD = [
    // The actual situation on 2026-08-21: upstream published v0.16.2 the day
    // before, and the repo vendors v0.16.1.
    release("v0.16.2", 0.9),
    release("v0.16.1", 93),
    release("v0.16.0", 140),
    release("v0.18.0-rc1", 5, { prerelease: true }),
  ];

  it("gives every fetched release a verdict and a reason", () => {
    const pick = pickRelease(REAL_WORLD, {
      vendoredTag: "v0.16.1",
      now: NOW,
    });
    expect(pick.action).toBe("none");
    expect(pick.considered).toHaveLength(REAL_WORLD.length);
    for (const v of pick.considered)
      expect(v.reason.length).toBeGreaterThan(10);

    const byTag = Object.fromEntries(pick.considered.map((v) => [v.tag, v]));
    expect(byTag["v0.16.2"]?.kind).toBe("soaking");
    expect(byTag["v0.16.2"]?.reason).toContain("6.1d left");
    expect(byTag["v0.16.1"]?.kind).toBe("vendored");
    expect(byTag["v0.16.0"]?.kind).toBe("older");
    expect(byTag["v0.18.0-rc1"]?.kind).toBe("prerelease");
  });

  it("renders the table with the decision on the first line", () => {
    const pick = pickRelease(REAL_WORLD, { vendoredTag: "v0.16.1", now: NOW });
    const report = renderReport(pick, {
      vendoredTag: "v0.16.1",
      soakDays: 7,
      now: NOW,
    });
    expect(report.split("\n")[0]).toContain("Decision: NONE");
    // Every release named, so the reader never has to ask "and what about…?"
    for (const r of REAL_WORLD) expect(report).toContain(r.tag_name);
    expect(report).toContain("soaking");
    expect(report).toContain("prerelease");
  });

  it("marks the proposed release and the ones it rolls up", () => {
    const pick = pickRelease(
      [
        release("v0.19.0", 1),
        release("v0.18.0", 9),
        release("v0.17.0", 40),
        release("v0.16.1", 90),
      ],
      { vendoredTag: "v0.16.1", now: NOW },
    );
    const byTag = Object.fromEntries(pick.considered.map((v) => [v.tag, v]));
    expect(byTag["v0.18.0"]?.kind).toBe("candidate");
    expect(byTag["v0.19.0"]?.kind).toBe("soaking");
    expect(byTag["v0.17.0"]?.kind).toBe("rolled-up");
    expect(byTag["v0.16.1"]?.kind).toBe("vendored");
    // …and the PR body carries the same table, so the reviewer sees the same
    // facts the log did.
    const body = renderProposal(pick, {
      vendoredTag: "v0.16.1",
      soakDays: 7,
      sha256: "abc",
      now: NOW,
    });
    expect(body).toContain("Every release considered");
    expect(body).toContain("v0.17.0");
  });

  it("names a skipped tag as skipped rather than dropping it", () => {
    const pick = pickRelease(
      [release("v0.17.1", 8), release("v0.17.0", 20), release("v0.16.1", 60)],
      { vendoredTag: "v0.16.1", now: NOW, skip: ["v0.17.1"] },
    );
    const byTag = Object.fromEntries(pick.considered.map((v) => [v.tag, v]));
    expect(byTag["v0.17.1"]?.kind).toBe("skipped");
    expect(byTag["v0.17.1"]?.reason).toContain("SKIP_TAGS");
  });

  // "0d old" for something published this morning reads as a bug report.
  it("reports a fresh release in hours, not zero days", () => {
    expect(formatAge(0.875)).toBe("21h");
    expect(formatAge(3.4)).toBe("3d");
    expect(formatAge(null)).toBe("unknown");
  });
});
