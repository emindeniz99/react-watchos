/**
 * Build-time guard: a watch bundle must contain exactly ONE copy of react
 * (and of react-reconciler).
 *
 * Why this exists as a gate rather than a README sentence: the renderer and
 * the app are separate packages, so a version range that differs between them
 * by a single patch resolves to two installs, and esbuild happily bundles
 * both. The reconciler then installs the hooks dispatcher onto ITS react's
 * shared internals while the app's components read the OTHER copy's — the
 * first `useState` reads `null` and the watch shows a blank screen. Nothing
 * else catches it: tsc sees one `@types/react`, vitest configs commonly set
 * `resolve.dedupe`, and the preset's `nodePaths` is only an esbuild *fallback*
 * (it is consulted when normal walk-up resolution fails, which it does not
 * when the renderer has its own node_modules/react). That combination shipped
 * a non-booting bundle once — hence a check on the actual module graph.
 *
 * It reads esbuild's metafile, so it is exact (module records, not a text
 * grep) and works on minified builds too.
 */
import type { Metafile, Plugin, PluginBuild } from "esbuild";

/** Packages a watch bundle must never contain twice. */
export const SINGLE_COPY_PACKAGES = ["react", "react-reconciler"] as const;

/** One package that appeared more than once, with each copy's install root. */
export interface DuplicateCopies {
  name: string;
  roots: string[];
}

/**
 * The install root of `name` that `input` belongs to, or undefined.
 * The LAST `node_modules/<name>/` segment wins, so a nested install is
 * attributed to itself rather than to whatever contains it. The trailing
 * slash is part of the match, so `react` never matches `react-reconciler`.
 */
function copyRoot(input: string, name: string): string | undefined {
  const marker = `node_modules/${name}/`;
  const at = input.lastIndexOf(marker);
  return at < 0 ? undefined : input.slice(0, at + marker.length);
}

/** Every package in `names` that the bundle pulled in from >1 install root. */
export function findDuplicateCopies(
  metafile: Metafile,
  names: readonly string[] = SINGLE_COPY_PACKAGES,
): DuplicateCopies[] {
  const found: DuplicateCopies[] = [];
  for (const name of names) {
    const roots = new Set<string>();
    for (const input of Object.keys(metafile.inputs)) {
      const root = copyRoot(input, name);
      if (root) roots.add(root);
    }
    if (roots.size > 1) found.push({ name, roots: [...roots].sort() });
  }
  return found;
}

/** The build error a duplicated package produces. */
export function duplicateCopyMessage({ name, roots }: DuplicateCopies): string {
  return (
    `this bundle would ship ${roots.length} copies of ${name}:\n` +
    roots.map((r) => `    ${r}`).join("\n") +
    `\n  Two copies of ${name} break hooks at runtime: the reconciler binds ` +
    "the dispatcher to one copy and your components read the other, so the " +
    "first useState() throws \"cannot read property 'useState' of null\" and " +
    "the watch renders nothing. Align the `react` range in this project's " +
    "package.json with the one react-watchos resolves (overlapping ranges " +
    "are what makes pnpm/npm dedupe — an exact pin next to a caret range " +
    "does not), then reinstall."
  );
}

/**
 * esbuild plugin form, wired into {@link watchBuildOptions} so every build
 * through the preset is gated — the repo's own bundles, both examples, and any
 * consumer's. Fails the build; it does not warn.
 */
export function singleCopyPlugin(
  names: readonly string[] = SINGLE_COPY_PACKAGES,
): Plugin {
  return {
    name: "single-copy",
    setup(build: PluginBuild) {
      build.onEnd((result) => {
        // The preset sets `metafile: true`. If a consumer turned it back off
        // the guard cannot run — say so instead of passing silently.
        if (!result.metafile) {
          return {
            errors: [
              {
                text:
                  "single-copy: needs `metafile: true` to check for duplicate " +
                  `copies of ${names.join("/")}; it was disabled after the preset set it.`,
              },
            ],
          };
        }
        const duplicates = findDuplicateCopies(result.metafile, names);
        if (duplicates.length === 0) return null;
        return { errors: duplicates.map((d) => ({ text: duplicateCopyMessage(d) })) };
      });
    },
  };
}
