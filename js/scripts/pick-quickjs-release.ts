// Decides WHETHER to propose a quickjs-ng engine bump, and to which release.
//
// The engine is this project's entire trust base and its whole runtime: a bad
// bump is a bricked watch app, so the interesting part of this file is not
// "fetch the newest tag" — it is the waiting policy.
//
// The policy is a SOAK with a hotfix warning:
//
//   candidate = the newest usable release that is at least `soakDays` old
//   soaking   = every usable release NEWER than that candidate
//
// A release younger than the soak window is never the candidate, because the
// two-day-old release is exactly the one that gets replaced by a hotfix. But a
// candidate is still proposed while something newer soaks — the PR just says so
// loudly, since a human decides whether to take the soaked version now or wait
// for the fresh one. (Refusing to open a PR at all would hide the choice.)
//
// Nothing here talks to the network; `pickRelease` is a pure function over the
// release list so the policy is testable, and the CLI at the bottom is the thin
// shell that fetches, calls it, and writes GITHUB_OUTPUT.

import { readFileSync, writeFileSync } from "node:fs";

/** The subset of GitHub's release payload the policy reads. */
export interface UpstreamRelease {
  tag_name: string;
  published_at: string | null;
  draft?: boolean;
  prerelease?: boolean;
  html_url?: string;
  body?: string | null;
}

export interface PickOptions {
  /** The tag currently vendored under js/swift/Sources/CQuickJS. */
  vendoredTag: string;
  /** Evaluation instant — injected so tests are not clock-dependent. */
  now: Date;
  /** How long a release must exist before it is proposable. */
  soakDays?: number;
  /** Tags a human marked known-bad; skipped as if they did not exist. */
  skip?: readonly string[];
}

/**
 * Why one upstream release is or is not the thing we vendor. Every release the
 * API returned gets one of these — including the ones that were never in the
 * running — because "skipped" with no reason is the report that makes you go
 * read the source to find out what the job did.
 */
export type VerdictKind =
  | "candidate"
  | "soaking"
  | "rolled-up"
  | "vendored"
  | "older"
  | "skipped"
  | "prerelease"
  | "draft";

export interface ReleaseVerdict {
  tag: string;
  publishedAt: string | null;
  ageDays: number | null;
  kind: VerdictKind;
  /** One sentence, written to be read in a job log by someone in a hurry. */
  reason: string;
}

export interface Pick {
  /** `propose` means "open or update the vendor PR for `candidate`". */
  action: "none" | "propose";
  /** Machine-ish reason, quoted into the job summary and the PR body. */
  reason: string;
  candidate?: UpstreamRelease;
  /** Usable releases newer than the vendored one, oldest first, candidate last. */
  behind: UpstreamRelease[];
  /** Usable releases NEWER than the candidate, still inside the soak window. */
  soaking: UpstreamRelease[];
  /** Releases dropped by the skip list, so the PR can say they were dropped. */
  skipped: UpstreamRelease[];
  /** Every release the API returned, newest first, each with its verdict. */
  considered: ReleaseVerdict[];
}

const DAY_MS = 86_400_000;

/** Age in days, or `null` for a release with no publish time (a draft). */
export function ageInDays(release: UpstreamRelease, now: Date): number | null {
  if (!release.published_at) return null;
  const published = Date.parse(release.published_at);
  if (Number.isNaN(published)) return null;
  return (now.getTime() - published) / DAY_MS;
}

/** "21h" reads as fresh; "0d" reads as a bug. Below two days, use hours. */
export function formatAge(days: number | null): string {
  if (days == null) return "unknown";
  if (days < 2) return `${Math.round(days * 24)}h`;
  return `${Math.floor(days)}d`;
}

/**
 * Give EVERY release a verdict, in the order upstream published them.
 *
 * Order matters here: a release can be several things at once (a prerelease
 * that is also too fresh, a skipped tag that is also older than ours), and the
 * first rule that matches is the one worth telling someone about.
 */
export function classifyReleases(
  releases: readonly UpstreamRelease[],
  opts: {
    vendoredTag: string;
    now: Date;
    soakDays: number;
    skip: ReadonlySet<string>;
    candidate?: UpstreamRelease | undefined;
    vendored?: UpstreamRelease | undefined;
  },
): ReleaseVerdict[] {
  const { vendoredTag, now, soakDays, skip, candidate, vendored } = opts;
  const vendoredAt = vendored?.published_at
    ? Date.parse(vendored.published_at)
    : Number.NEGATIVE_INFINITY;
  const candidateAt = candidate?.published_at
    ? Date.parse(candidate.published_at)
    : null;

  return releases.map((r) => {
    const ageDays = ageInDays(r, now);
    const base = {
      tag: r.tag_name,
      publishedAt: r.published_at,
      ageDays,
    };
    if (r.draft) {
      return { ...base, kind: "draft" as const, reason: "never proposable" };
    }
    if (r.prerelease) {
      return {
        ...base,
        kind: "prerelease" as const,
        reason: "the watch does not ship one",
      };
    }
    if (skip.has(r.tag_name)) {
      return {
        ...base,
        kind: "skipped" as const,
        reason: "on the SKIP_TAGS list; a human marked this one known-bad",
      };
    }
    if (r.tag_name === vendoredTag) {
      return {
        ...base,
        kind: "vendored" as const,
        reason: "this is what the repo vendors today",
      };
    }
    if (ageDays != null && ageDays < soakDays) {
      const left = (soakDays - ageDays).toFixed(1);
      return {
        ...base,
        kind: "soaking" as const,
        reason:
          `${left}d left of the ${soakDays}d soak; a release this new is the ` +
          "one most likely to be replaced by a hotfix",
      };
    }
    if (candidate && r.tag_name === candidate.tag_name) {
      return {
        ...base,
        kind: "candidate" as const,
        reason: "the newest release that has soaked; this is the bump",
      };
    }
    const at = r.published_at ? Date.parse(r.published_at) : Number.NaN;
    if (candidateAt != null && at > vendoredAt && at < candidateAt) {
      return {
        ...base,
        kind: "rolled-up" as const,
        reason: "superseded by the candidate; its changes come with this bump",
      };
    }
    return {
      ...base,
      kind: "older" as const,
      reason: "predates the vendored engine; nothing to do",
    };
  });
}

/**
 * Apply the soak policy to an unsorted release list.
 *
 * Returns `action: "none"` when there is nothing to do — already current,
 * nothing has soaked yet, or (the case worth naming) the vendored engine is
 * NEWER than the candidate, which happens after a hand-vendored bump and must
 * never be "fixed" by proposing a downgrade.
 */
export function pickRelease(
  releases: readonly UpstreamRelease[],
  { vendoredTag, now, soakDays = 7, skip = [] }: PickOptions,
): Pick {
  const skipSet = new Set(skip);
  const published = releases.filter(
    (r) => !r.draft && !r.prerelease && r.published_at,
  );
  // Newest first. published_at, not tag order: tags do not sort semantically
  // (v0.10.0 vs v0.9.0) and a re-tagged release would sort wrong.
  const sorted = [...published].sort(
    (a, b) =>
      Date.parse(b.published_at as string) -
      Date.parse(a.published_at as string),
  );
  const skipped = sorted.filter((r) => skipSet.has(r.tag_name));
  const usable = sorted.filter((r) => !skipSet.has(r.tag_name));

  // The report covers EVERY release the API returned, not just the usable ones
  // — a reader asking "what about v0.18.0-rc1?" deserves the answer in the same
  // table. Drafts carry no publish time, so they sort last rather than vanish.
  const all = [...releases].sort(
    (a, b) =>
      (b.published_at ? Date.parse(b.published_at) : 0) -
      (a.published_at ? Date.parse(a.published_at) : 0),
  );
  const vendoredRelease = all.find((r) => r.tag_name === vendoredTag);
  const report = (chosen?: UpstreamRelease): ReleaseVerdict[] =>
    classifyReleases(all, {
      vendoredTag,
      now,
      soakDays,
      skip: skipSet,
      candidate: chosen,
      vendored: vendoredRelease,
    });

  const candidateIndex = usable.findIndex(
    (r) => (ageInDays(r, now) ?? -1) >= soakDays,
  );
  if (candidateIndex === -1) {
    return {
      action: "none",
      reason:
        usable.length === 0
          ? "upstream has no usable (non-draft, non-prerelease) releases"
          : `nothing has soaked ${soakDays} days yet (newest: ${usable[0]?.tag_name})`,
      behind: [],
      soaking: usable,
      skipped,
      considered: report(),
    };
  }
  const candidate = usable[candidateIndex] as UpstreamRelease;
  const soaking = usable.slice(0, candidateIndex);

  if (candidate.tag_name === vendoredTag) {
    return {
      action: "none",
      reason:
        soaking.length > 0
          ? `already on ${vendoredTag}; waiting on ${soaking
              .map((r) => {
                const age = ageInDays(r, now);
                const left = age == null ? "?" : (soakDays - age).toFixed(1);
                return `${r.tag_name} (${left}d of soak left)`;
              })
              .join(", ")}`
          : `already on ${vendoredTag}; upstream has published nothing newer`,
      candidate,
      behind: [],
      soaking,
      skipped,
      considered: report(candidate),
    };
  }

  // The downgrade guard. If the vendored tag is in the list and is at least as
  // new as the candidate, someone vendored ahead of the soak window on purpose
  // — proposing the older candidate would silently walk that back.
  const vendored = sorted.find((r) => r.tag_name === vendoredTag);
  if (
    vendored?.published_at &&
    Date.parse(vendored.published_at) >=
      Date.parse(candidate.published_at as string)
  ) {
    return {
      action: "none",
      reason: `vendored ${vendoredTag} is newer than the soaked candidate ${candidate.tag_name}`,
      candidate,
      behind: [],
      soaking,
      skipped,
      considered: report(candidate),
    };
  }

  // Everything strictly newer than the vendored release, up to the candidate —
  // oldest first, so the PR body reads as a changelog in release order.
  const vendoredAt = vendored?.published_at
    ? Date.parse(vendored.published_at)
    : Number.NEGATIVE_INFINITY;
  const behind = usable
    .slice(candidateIndex)
    .filter((r) => Date.parse(r.published_at as string) > vendoredAt)
    .reverse();

  return {
    action: "propose",
    reason: vendored
      ? `${behind.length} release(s) behind; ${candidate.tag_name} has soaked`
      : `vendored tag ${vendoredTag} is not in the fetched release list; proposing ${candidate.tag_name}`,
    candidate,
    behind,
    soaking,
    skipped,
    considered: report(candidate),
  };
}

/** Reads the vendored tag from the engine header — the source of truth. */
export function vendoredTagFromHeader(header: string): string {
  const read = (name: string): string => {
    const match = new RegExp(`#define\\s+QJS_VERSION_${name}\\s+(\\S+)`).exec(
      header,
    );
    if (!match?.[1]) throw new Error(`QJS_VERSION_${name} not found in header`);
    return match[1].replace(/"/g, "");
  };
  const suffix = /#define\s+QJS_VERSION_SUFFIX\s+"([^"]*)"/.exec(header);
  return `v${read("MAJOR")}.${read("MINOR")}.${read("PATCH")}${suffix?.[1] ?? ""}`;
}

const ICON: Record<VerdictKind, string> = {
  candidate: "✅",
  soaking: "⏳",
  "rolled-up": "↪️",
  vendored: "📌",
  older: "·",
  skipped: "🚫",
  prerelease: "🧪",
  draft: "📝",
};

/**
 * The full decision table: every release upstream returned, what the bot
 * decided about it, and why.
 *
 * This exists because the first real run was twelve green seconds with every
 * later step marked "skipped" — technically correct, and useless. A scheduled
 * job that decides to do nothing has to SHOW its work, or the next person to
 * look at it has to read the source to find out whether it was thinking or
 * broken. Markdown, because the same text goes to the step summary, the PR
 * body, and the log — a table is still readable as plain text.
 */
export function renderReport(
  pick: Pick,
  opts: {
    vendoredTag: string;
    soakDays: number;
    now: Date;
    /** How many `older` rows to show in full beyond the recent window. */
    olderExamples?: number;
    /** `older` releases this fresh are always shown in full. */
    olderWindowDays?: number;
  },
): string {
  const olderExamples = opts.olderExamples ?? 3;
  const olderWindowDays = opts.olderWindowDays ?? 30;
  const lines = [
    `**Decision: ${pick.action.toUpperCase()}** — ${pick.reason}`,
    "",
    `Vendored \`${opts.vendoredTag}\` · soak window ${opts.soakDays}d · ` +
      `${pick.considered.length} release(s) fetched · ` +
      `checked ${opts.now.toISOString().replace("T", " ").slice(0, 16)} UTC`,
    "",
    "| | release | published | age | verdict |",
    "|---|---|---|---|---|",
  ];
  // The API hands back 30 releases and most of them predate the vendored
  // engine, so printing all of them buries the three rows that carry the
  // decision. Only the `older` tail is thinned — every verdict that could
  // change what happens (candidate, soaking, skipped, prerelease…) is always
  // shown in full. An `older` release survives if it is recent enough to still
  // be interesting OR is one of the first few, so the table always ends with
  // some history rather than a cliff.
  const row = (v: ReleaseVerdict): string =>
    `| ${ICON[v.kind]} | \`${v.tag}\` | ${v.publishedAt?.slice(0, 10) ?? "—"}` +
    ` | ${formatAge(v.ageDays)} | **${v.kind}** — ${v.reason} |`;

  let olderSeen = 0;
  const collapsed: ReleaseVerdict[] = [];
  for (const v of pick.considered) {
    if (v.kind !== "older") {
      lines.push(row(v));
      continue;
    }
    olderSeen += 1;
    const recent = v.ageDays != null && v.ageDays <= olderWindowDays;
    if (recent || olderSeen <= olderExamples) lines.push(row(v));
    else collapsed.push(v);
  }
  if (collapsed.length > 0) {
    const first = collapsed[0]?.tag;
    const last = collapsed[collapsed.length - 1]?.tag;
    lines.push(
      `| · | ${collapsed.length} more | — | — | **older** — \`${first}\` down to` +
        ` \`${last}\`, all predating the vendored engine |`,
    );
  }
  if (pick.action === "propose" && pick.soaking.length > 0) {
    lines.push(
      "",
      `⚠️ ${pick.soaking.length} release(s) newer than the candidate are still` +
        " soaking — see the warning at the top of the PR before merging.",
    );
  }
  return lines.join("\n");
}

/**
 * Markdown for the PR body: what is being proposed, what it costs to wait, and
 * the release notes in between. The soak warning is first because it is the one
 * thing a reviewer must not scroll past.
 */
export function renderProposal(
  pick: Pick,
  opts: { vendoredTag: string; soakDays: number; sha256: string; now: Date },
): string {
  const candidate = pick.candidate;
  if (!candidate) return `No candidate. ${pick.reason}`;
  // formatAge, not a second implementation: a release published this morning
  // reported as "0d old" reads as a bug in the bot rather than as freshness.
  const age = (r: UpstreamRelease): string =>
    `${formatAge(ageInDays(r, opts.now))} old`;
  const lines: string[] = [];

  if (pick.soaking.length > 0) {
    lines.push(
      `> [!WARNING]`,
      `> **A newer release already exists.** ${candidate.tag_name} has soaked` +
        ` ${opts.soakDays} days, but upstream has since published` +
        ` ${pick.soaking.map((r) => `\`${r.tag_name}\` (${age(r)})`).join(", ")}.`,
      `> A release that is replaced within days is usually replaced *because of*` +
        ` a defect, so taking this one now may be taking the one that was fixed.`,
      `> Merging is a judgement call: take ${candidate.tag_name} if you need it,` +
        ` otherwise close this and the bot will propose the newer one once it soaks.`,
      "",
    );
  }

  lines.push(
    `Vendored: \`${opts.vendoredTag}\` → proposed: \`${candidate.tag_name}\` (${age(candidate)}).`,
    "",
    `### Releases in between (${pick.behind.length})`,
    "",
  );
  for (const r of pick.behind) {
    lines.push(
      `- **${r.tag_name}** — ${r.published_at?.slice(0, 10)} (${age(r)})` +
        (r.html_url ? ` · [notes](${r.html_url})` : ""),
    );
    const notable = (r.body ?? "")
      .split("\n")
      .filter((line) =>
        /\b(fix|security|CVE|crash|regression|revert)\b/i.test(line),
      )
      .slice(0, 6);
    for (const line of notable) lines.push(`  - ${line.trim().slice(0, 200)}`);
  }
  if (pick.skipped.length > 0) {
    lines.push(
      "",
      `Skipped by policy: ${pick.skipped.map((r) => `\`${r.tag_name}\``).join(", ")}.`,
    );
  }
  lines.push(
    "",
    "### Every release considered",
    "",
    renderReport(pick, {
      vendoredTag: opts.vendoredTag,
      soakDays: opts.soakDays,
      now: opts.now,
    }),
    "",
    "### Trust (M9)",
    "",
    "The engine executes every signed OTA bundle, so its tarball digest must be",
    "confirmed through a channel that is not this bot — the bot downloaded and",
    "hashed the same file it is proposing, which proves nothing on its own.",
    "",
    "```",
    `curl -fsSL https://github.com/quickjs-ng/quickjs/archive/refs/tags/${candidate.tag_name}.tar.gz | shasum -a 256`,
    `# expected: ${opts.sha256}`,
    "```",
    "",
    "Match it against the digest above, then add the **`engine-digest-attested`**",
    "label — the required check on this PR fails until that label is present.",
  );
  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// Used by .github/workflows/vendor-quickjs.yml. Prints a JSON document on
// stdout; the workflow reads it with jq rather than parsing prose.
if (process.argv[1]?.endsWith("pick-quickjs-release.ts")) {
  // Second mode: re-render the PR body once the workflow has the tarball
  // digest (which only exists after the download, i.e. after the decision).
  //   pick-quickjs-release.ts --render <pick.json> <sha256>
  if (process.argv[2] === "--render") {
    const pickPath = process.argv[3];
    const sha256 = process.argv[4];
    if (!pickPath || !sha256) {
      throw new Error("usage: --render <pick.json> <tarball-sha256>");
    }
    const saved = JSON.parse(readFileSync(pickPath, "utf8")) as {
      pick: Pick;
      vendoredTag: string;
      soakDays: number;
      checkedAt?: string;
    };
    console.log(
      renderProposal(saved.pick, {
        vendoredTag: saved.vendoredTag,
        soakDays: saved.soakDays,
        sha256,
        now: saved.checkedAt ? new Date(saved.checkedAt) : new Date(),
      }),
    );
    process.exit(0);
  }

  const soakDays = Number(process.env.SOAK_DAYS ?? "7");
  const skip = (process.env.SKIP_TAGS ?? "")
    .split(/[,\s]+/)
    .filter((s) => s.length > 0);
  const headerPath = new URL(
    "../swift/Sources/CQuickJS/include/quickjs.h",
    import.meta.url,
  );
  // VENDORED_TAG belongs to the same dry-run seam as RELEASES_JSON/NOW below.
  // Without it the vendored tag comes only from the header, so any fixture that
  // describes a scenario relative to what is vendored drifts with the tree — and
  // on a bump branch the header ALREADY names the new release, which flips
  // "v0.16.2 is still soaking" into "vendored is newer than the candidate" and
  // fails the bot's own gate on every PR it opens (run 33723399318).
  const vendoredTag =
    process.env.VENDORED_TAG ??
    vendoredTagFromHeader(readFileSync(headerPath, "utf8"));

  // A dry-run seam. The workflow never sets this; it exists so the decision can
  // be reproduced offline against a saved release list — which is how you debug
  // "why did the bot do that?" without waiting a day for the next schedule, and
  // how the output below was checked against upstream's real tags.
  //   RELEASES_JSON=fixture.json node --experimental-strip-types <this file>
  if (process.env.RELEASES_JSON) {
    const releases = JSON.parse(
      readFileSync(process.env.RELEASES_JSON, "utf8"),
    ) as UpstreamRelease[];
    const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
    const pick = pickRelease(releases, { vendoredTag, now, soakDays, skip });
    writePick(pick, { vendoredTag, soakDays, checkedAt: now });
    console.log(renderReport(pick, { vendoredTag, soakDays, now }));
    process.exit(0);
  }

  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "react-watchos-vendor-bot",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const response = await fetch(
    "https://api.github.com/repos/quickjs-ng/quickjs/releases?per_page=30",
    { headers },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub releases API: ${response.status} ${response.statusText}`,
    );
  }
  const releases = (await response.json()) as UpstreamRelease[];
  const now = new Date();
  const pick = pickRelease(releases, { vendoredTag, now, soakDays, skip });

  // Two outputs, on purpose. The machine-readable one goes to a FILE (the
  // workflow reads `.action`/`.tag` from it with jq), and stdout carries the
  // human decision table — so the log of a run that decides to do nothing still
  // states what it saw and why, instead of a row of "skipped" steps.
  writePick(pick, { vendoredTag, soakDays, checkedAt: now });
  console.log(renderReport(pick, { vendoredTag, soakDays, now }));
}

/** The machine-readable half: what the workflow reads back with jq. */
function writePick(
  pick: Pick,
  meta: { vendoredTag: string; soakDays: number; checkedAt: Date },
): void {
  const { vendoredTag, soakDays, checkedAt } = meta;
  writeFileSync(
    process.env.PICK_OUT ?? "pick.json",
    JSON.stringify(
      {
        action: pick.action,
        reason: pick.reason,
        vendoredTag,
        soakDays,
        // The instant the decision was made. `--render` runs minutes later (the
        // tarball has to be downloaded first) and MUST reuse this rather than
        // reading the clock again: every age in the report is relative to it,
        // and a report whose ages disagree with the decision that produced them
        // is worse than no report.
        checkedAt: checkedAt.toISOString(),
        tag: pick.candidate?.tag_name ?? "",
        soakingCount: pick.soaking.length,
        behindCount: pick.behind.length,
        // The body still needs the tarball digest, which the workflow computes
        // after downloading; it re-renders with `renderProposal` at that point.
        pick,
      },
      null,
      2,
    ),
  );
}
