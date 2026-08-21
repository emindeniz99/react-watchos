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
}

const DAY_MS = 86_400_000;

/** Age in days, or `null` for a release with no publish time (a draft). */
export function ageInDays(
  release: UpstreamRelease,
  now: Date,
): number | null {
  if (!release.published_at) return null;
  const published = Date.parse(release.published_at);
  if (Number.isNaN(published)) return null;
  return (now.getTime() - published) / DAY_MS;
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
    };
  }
  const candidate = usable[candidateIndex] as UpstreamRelease;
  const soaking = usable.slice(0, candidateIndex);

  if (candidate.tag_name === vendoredTag) {
    return {
      action: "none",
      reason: `already on ${vendoredTag}`,
      candidate,
      behind: [],
      soaking,
      skipped,
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
  const age = (r: UpstreamRelease): string => {
    const days = ageInDays(r, opts.now);
    return days == null ? "?" : `${Math.floor(days)}d old`;
  };
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
      .filter((line) => /\b(fix|security|CVE|crash|regression|revert)\b/i.test(line))
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
  const { readFileSync } = await import("node:fs");

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
    };
    console.log(
      renderProposal(saved.pick, {
        vendoredTag: saved.vendoredTag,
        soakDays: saved.soakDays,
        sha256,
        now: new Date(),
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
  const vendoredTag = vendoredTagFromHeader(readFileSync(headerPath, "utf8"));

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
    throw new Error(`GitHub releases API: ${response.status} ${response.statusText}`);
  }
  const releases = (await response.json()) as UpstreamRelease[];
  const now = new Date();
  const pick = pickRelease(releases, { vendoredTag, now, soakDays, skip });
  console.log(
    JSON.stringify(
      {
        action: pick.action,
        reason: pick.reason,
        vendoredTag,
        soakDays,
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
