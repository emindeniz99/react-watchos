// The symbol store: the durable link between a stack from the field and the
// map that can read it.
//
// A consumer builds their own bundles, ships them, and weeks later gets a crash
// stack out of a diagnostics ring. The map that could resolve it was written
// next to the outfile at build time and has since been overwritten by the next
// build — so "which map matches this stack?" is guesswork unless the build KEPT
// the map under something the stack itself carries.
//
// It carries exactly one thing: `releaseId`, the FNV-1a over the exact shipped
// bytes that `writeOTAManifest` stamps (manifest.mts) and every `Diagnostic`
// records (src/diagnostics.ts, Diagnostic.swift). That is the identity, and
// deliberately the ONLY one: a third id next to the OTA compatibility `version`
// and this freshness hash would be one more thing to keep in sync and the first
// one to drift.
//
// Layout — one directory per (release, TARGET):
//
//   <symbolsDir>/<releaseId>/<target>/bundle.js
//                                    /bundle.js.map
//                                    /metadata.json
//
// The target level is not decoration. App and widget are separate bundles in
// separate processes (ARCH-03) built from the same tree at the same instant,
// and a widget frame resolved through the app's map does not fail — it returns
// a confident wrong answer, which is worse. Keying by release alone would allow
// exactly that, and the two bundles even SHARE a `releaseId` whenever their
// bytes happen to be identical, so "one release, one map" is not a fallback
// that could be assumed.
//
// Written by `buildBundles({ symbols })` (esbuild/preset.mts), read by
// `pnpm symbolicate --symbols` (scripts/symbolicate.ts). Both sides live here
// so the layout is stated once and cannot drift apart.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

/** The per-entry metadata file name. */
export const SYMBOL_METADATA_FILE = "metadata.json";

/** What one stored (release, target) pair records about its build. */
export interface SymbolMetadata {
  /** The `BundleTarget.name` this was built as ("app", "widget", …). */
  target: string;
  /** The bundle's file name in this directory (the outfile's basename). */
  bundle: string;
  /** The map's file name, or `null` when the build emitted none. */
  map: string | null;
  /** Size of the bundle in bytes — the exact bytes `releaseId` hashes. */
  bytes: number;
  /** FNV-1a over those bytes: the identity a field stack arrives with. */
  releaseId: string;
  /**
   * The build settings that decide how much a stack needs this store. All
   * three are recorded because "why does this frame read `at t`?" is answered
   * by them and by nothing else in the directory: `minify` renames the locals,
   * `keepNames` is whether they were bought back in the bundle, and
   * `sourcemap` is whether a map exists to buy them back at rest.
   */
  minify: boolean;
  keepNames: boolean;
  sourcemap: boolean;
}

/**
 * Fold a target name into ONE path segment.
 *
 * A `BundleTarget.name` defaults to its OUTFILE (that is what the build log
 * prints), which is a path — joining it in raw would scatter the store across
 * the filesystem on the first `/`, or escape the release directory on a `..`.
 * Anything that is not a plain name character folds to `-`, so every target
 * still lands in its own directory and the store stays a two-level tree.
 */
export function symbolTargetDir(target: string): string {
  const folded = target.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "");
  return folded || "target";
}

/** Options for {@link writeSymbolEntry}. */
export interface WriteSymbolEntryOptions {
  /** The store root (`buildBundles({ symbols })` / `--symbols <dir>`). */
  symbolsDir: string;
  /** FNV-1a of the built bytes — @see SymbolMetadata.releaseId */
  releaseId: string;
  target: string;
  /** The built bundle, still where esbuild wrote it. */
  outfile: string;
  minify: boolean;
  keepNames: boolean;
  sourcemap: boolean;
}

/**
 * Copy one built bundle, its map and a `metadata.json` into
 * `<symbolsDir>/<releaseId>/<target>/`. Idempotent: rebuilding the same bytes
 * overwrites the same entry.
 */
export function writeSymbolEntry({
  symbolsDir,
  releaseId,
  target,
  outfile,
  minify,
  keepNames,
  sourcemap,
}: WriteSymbolEntryOptions): { dir: string; metadata: SymbolMetadata } {
  const dir = join(symbolsDir, releaseId, symbolTargetDir(target));
  mkdirSync(dir, { recursive: true });
  const bundle = basename(outfile);
  // The BUNDLE is copied, not just the map: a map is only meaningful against
  // the generated text it was emitted for, and having both means the store can
  // also answer "were these really the shipped bytes?" — re-hash the copy and
  // compare it to the directory name.
  copyFileSync(outfile, join(dir, bundle));
  const mapSource = `${outfile}.map`;
  // Recorded from what is actually on disk, not from the option: an entry that
  // claims a map it does not have sends the reader looking for a bug in the
  // symbolicator instead of at a `sourcemap: false` build.
  const map = existsSync(mapSource) ? `${bundle}.map` : null;
  if (map) copyFileSync(mapSource, join(dir, map));
  const metadata: SymbolMetadata = {
    target,
    bundle,
    map,
    bytes: statSync(outfile).size,
    releaseId,
    minify,
    keepNames,
    sourcemap,
  };
  writeFileSync(
    join(dir, SYMBOL_METADATA_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  return { dir, metadata };
}

/** One (release, target) pair, as {@link readSymbolEntry} resolved it. */
export interface SymbolStoreEntry {
  releaseId: string;
  /** The directory name under the release (see {@link symbolTargetDir}). */
  target: string;
  /** The entry's directory. */
  dir: string;
  metadata: SymbolMetadata;
  /** Absolute path of the map, or `null` when the entry has none. */
  mapPath: string | null;
  /** Absolute path of the stored bundle. */
  bundlePath: string;
}

function subdirectories(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Every (release, targets) pair the store holds, release id ascending. */
export function listSymbolStore(
  symbolsDir: string,
): { releaseId: string; targets: string[] }[] {
  return subdirectories(symbolsDir)
    .map((releaseId) => ({
      releaseId,
      targets: subdirectories(join(symbolsDir, releaseId)).filter((t) =>
        existsSync(join(symbolsDir, releaseId, t, SYMBOL_METADATA_FILE)),
      ),
    }))
    .filter((r) => r.targets.length > 0);
}

/**
 * The store's contents as an indented block, for the error a wrong `releaseId`
 * deserves: "not found" alone leaves you unable to tell a typo from a store you
 * never uploaded to.
 */
export function describeSymbolStore(symbolsDir: string, limit = 20): string {
  const releases = listSymbolStore(symbolsDir);
  if (releases.length === 0) return `  (no releases in ${symbolsDir})`;
  const lines = releases
    .slice(0, limit)
    .map((r) => `  ${r.releaseId}  ${r.targets.join(", ")}`);
  if (releases.length > limit) {
    lines.push(`  … and ${releases.length - limit} more`);
  }
  return lines.join("\n");
}

/** Options for {@link readSymbolEntry}. */
export interface ReadSymbolEntryOptions {
  symbolsDir: string;
  releaseId: string;
  /** Hard requirement — fail when the release has no such target. */
  target?: string | undefined;
  /**
   * Soft hint, used ONLY to break a tie between several targets of one
   * release: a `Diagnostic` carries its own `watch`/`widget`, which matches a
   * store target often enough to be worth trying and is not authoritative
   * enough to fail on (a consumer may have named the app target "app").
   */
  preferTarget?: string | undefined;
}

/**
 * Find one entry in the store, erroring with what the store DOES hold when the
 * release (or the target within it) is not there.
 */
export function readSymbolEntry({
  symbolsDir,
  releaseId,
  target,
  preferTarget,
}: ReadSymbolEntryOptions): SymbolStoreEntry {
  if (!existsSync(symbolsDir)) {
    throw new Error(
      `no symbol store at ${symbolsDir} — build with ` +
        "`react-watchos build --symbols <dir>` (or `buildBundles({ symbols })`) " +
        "and keep the directory with your release artifacts.",
    );
  }
  const releaseDir = join(symbolsDir, releaseId);
  const targets = subdirectories(releaseDir).filter((t) =>
    existsSync(join(releaseDir, t, SYMBOL_METADATA_FILE)),
  );
  if (targets.length === 0) {
    throw new Error(
      `no symbols for releaseId ${releaseId} in ${symbolsDir}\n` +
        `this store holds:\n${describeSymbolStore(symbolsDir)}`,
    );
  }
  let picked: string | undefined;
  if (target !== undefined) {
    const wanted = symbolTargetDir(target);
    picked = targets.find((t) => t === wanted);
    if (!picked) {
      throw new Error(
        `release ${releaseId} has no target "${target}" — it holds: ` +
          `${targets.join(", ")}`,
      );
    }
  } else if (targets.length === 1) {
    picked = targets[0];
  } else {
    // Several bundles share these bytes. Refusing to guess IS the feature: the
    // wrong map here does not fail, it lies.
    picked =
      preferTarget === undefined
        ? undefined
        : targets.find((t) => t === symbolTargetDir(preferTarget));
    if (!picked) {
      throw new Error(
        `release ${releaseId} holds ${targets.length} targets ` +
          `(${targets.join(", ")}) — pass --target <name>; an app map applied ` +
          "to a widget stack resolves to confident nonsense.",
      );
    }
  }
  const dir = join(releaseDir, picked);
  const metadata = JSON.parse(
    readFileSync(join(dir, SYMBOL_METADATA_FILE), "utf8"),
  ) as SymbolMetadata;
  return {
    releaseId,
    target: picked,
    dir,
    metadata,
    mapPath: metadata.map ? join(dir, metadata.map) : null,
    bundlePath: join(dir, metadata.bundle),
  };
}
