/**
 * The BUILD half of the DEBUG-only source-level debugger
 * (docs/design-dap-debugger.md). A Babel pass rewrites every statement to call
 * `__dbg(fileId, line)` first and every function body to push/pop a shadow
 * frame, so the watch can stop on a line without the engine knowing what a
 * breakpoint is.
 *
 * WHY a source transform and not the engine: quickjs-ng ships no debug API,
 * and the one implementation that exists (koush/quickjs) is an engine fork with
 * a second opcode dispatch table. `js/swift/Sources/CQuickJS` is refreshed
 * file-by-file from upstream by a bot, so a patched engine would make every
 * bump a merge — the constraint that decides this design.
 *
 * WHY Babel and not a hand-rolled parser: the repo already carries
 * `@babel/core` (+ preset-typescript/preset-react) as optional peers for the
 * React Compiler, and instrumenting statement boundaries correctly means
 * knowing what a statement IS in TSX. Prior art is
 * [babel-plugin-istanbul](https://github.com/istanbuljs/babel-plugin-istanbul),
 * which puts a counter at exactly these boundaries; the difference is that we
 * need frames as well as lines, and that we must never reach production.
 *
 * WHY the plugin is not just handed to `reactCompilerPlugin`: esbuild runs the
 * FIRST `onLoad` callback that returns a result and no others, so two transform
 * plugins on the same filter silently mean "only the first one runs". The
 * preset therefore installs THIS plugin instead of the React Compiler's in a
 * debug build (see `debug` in preset.mts) — and deliberately does not run the
 * compiler at all, because the compiler rewrites code before we could read its
 * line numbers, and a debugger whose lines are off by a memoization block is
 * worse than no debugger.
 */
import { dirname } from "node:path";
import type { NodePath, PluginObject, types as BabelTypes } from "@babel/core";
import type { OnLoadArgs, OnLoadResult, Plugin, PluginBuild } from "esbuild";

/** Bumped when the `<outfile>.dbg.json` shape changes. */
export const DEBUG_MANIFEST_VERSION = 1;

/** One instrumented source file, as recorded in `<outfile>.dbg.json`. */
export interface DebugManifestFile {
  /** Absolute path — what a DAP client sends as `source.path`. */
  path: string;
  /** Every line that carries a probe, ascending. A breakpoint on any other
   *  line can only be honored by moving it, which is what DAP's "actual"
   *  breakpoint in the `setBreakpoints` response is for. */
  lines: number[];
}

/** What the build writes beside the bundle for the dev server to read. */
export interface DebugManifest {
  v: number;
  files: DebugManifestFile[];
}

/** Build-wide state: file ids, function ids and probe lines. */
export class DebugRegistry {
  readonly files: DebugManifestFile[] = [];
  private readonly byPath = new Map<string, number>();
  /** path → the contiguous function-id block already handed to that file, so
   *  an incremental rebuild of ONE file keeps the ids the rest of the bundle
   *  (which esbuild served from its onLoad cache) still refers to. */
  private readonly blocks = new Map<string, { start: number; count: number }>();
  private nextFunctionId = 0;

  fileId(path: string): number {
    const existing = this.byPath.get(path);
    if (existing !== undefined) {
      // A re-transform of the same file replaces its probe lines wholesale.
      this.files[existing] = { path, lines: [] };
      return existing;
    }
    const id = this.files.length;
    this.files.push({ path, lines: [] });
    this.byPath.set(path, id);
    return id;
  }

  addLine(fileId: number, line: number): void {
    const file = this.files[fileId];
    if (file && !file.lines.includes(line)) file.lines.push(line);
  }

  /** Reserve `count` consecutive function ids for `path`. */
  functionBlock(path: string, count: number): number {
    const previous = this.blocks.get(path);
    if (previous && count <= previous.count) return previous.start;
    const start = this.nextFunctionId;
    this.nextFunctionId += count;
    this.blocks.set(path, { start, count });
    return start;
  }

  manifest(): DebugManifest {
    return {
      v: DEBUG_MANIFEST_VERSION,
      files: this.files.map((f) => ({
        path: f.path,
        lines: [...f.lines].sort((a, b) => a - b),
      })),
    };
  }
}

/** `[name, fileId, declarationLine, capturedParameterNames]`. */
type FunctionEntry = [string, number, number, string[]];

type Statement = BabelTypes.Statement;
type Fn = BabelTypes.Function;

/** Statement kinds a probe must never precede. Import/export declarations are
 *  module syntax esbuild reads structurally; function/class declarations are
 *  hoisted, so a probe "before" one would report a line that never runs. */
const UNPROBEABLE = new Set([
  "ImportDeclaration",
  "ExportAllDeclaration",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "FunctionDeclaration",
  "ClassDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSDeclareFunction",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "EmptyStatement",
]);

/** Best-effort readable name for a frame: what a developer would call this
 *  function when they see it in a stack, not what the AST calls it. */
function functionName(path: NodePath<Fn>, t: typeof BabelTypes): string {
  const node = path.node;
  if (
    (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) &&
    node.id
  ) {
    return node.id.name;
  }
  if (t.isObjectMethod(node) || t.isClassMethod(node)) {
    const key = node.key;
    if (t.isIdentifier(key)) return key.name;
    if (t.isStringLiteral(key)) return key.value;
  }
  const parent = path.parent;
  if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
    return parent.id.name;
  }
  if (t.isObjectProperty(parent) && t.isIdentifier(parent.key)) {
    return parent.key.name;
  }
  if (t.isClassProperty(parent) && t.isIdentifier(parent.key)) {
    return parent.key.name;
  }
  return "(anonymous)";
}

/**
 * The Babel plugin, as a factory over the build-wide {@link DebugRegistry}.
 * Exported so the transform can be tested against a source string directly,
 * with no esbuild build around it.
 */
export function debugProbeBabelPlugin(
  registry: DebugRegistry,
): (api: { types: typeof BabelTypes }) => PluginObject {
  return ({ types: t }) => {
    // Per-transform state. One plugin object serves one file, and esbuild runs
    // onLoad callbacks concurrently — so none of this may be module-scoped.
    let fileId = -1;
    let filename = "";
    let entries: FunctionEntry[] = [];
    let pendingPushes: Array<(blockStart: number) => void> = [];
    const done = new WeakSet<object>();

    const probeCall = (line: number): Statement => {
      registry.addLine(fileId, line);
      const call = t.expressionStatement(
        t.callExpression(t.identifier("__dbg"), [
          t.numericLiteral(fileId),
          t.numericLiteral(line),
        ]),
      );
      done.add(call);
      return call;
    };

    /** Rewrite one statement list, putting a probe before each probeable one. */
    const instrument = (body: Statement[]): Statement[] => {
      const out: Statement[] = [];
      for (const statement of body) {
        const line = statement.loc?.start.line;
        if (
          line !== undefined &&
          !done.has(statement) &&
          !UNPROBEABLE.has(statement.type)
        ) {
          out.push(probeCall(line));
        }
        out.push(statement);
      }
      return out;
    };

    return {
      name: "react-watchos-debug-probe",
      visitor: {
        Program: {
          enter(_path, state) {
            filename = (state as { filename?: string }).filename ?? "";
            fileId = registry.fileId(filename);
            entries = [];
            pendingPushes = [];
          },
          // exit: every child is already instrumented, so the probes inserted
          // here are never re-traversed (this container path has exited) and
          // the registration prologue lands ahead of everything.
          exit(path) {
            path.node.body = instrument(path.node.body);
            if (entries.length === 0) return;
            const start = registry.functionBlock(filename, entries.length);
            // Function ids are minted per file and only become absolute here,
            // where the block start is known — so each push call left a patch.
            for (const patch of pendingPushes) patch(start);
            pendingPushes = [];
            const registration = t.expressionStatement(
              t.callExpression(t.identifier("__dbg_r"), [
                t.numericLiteral(start),
                t.valueToNode(entries),
              ]),
            );
            done.add(registration);
            path.node.body.unshift(registration);
          },
        },
        BlockStatement: {
          exit(path) {
            path.node.body = instrument(path.node.body);
          },
        },
        SwitchCase: {
          exit(path) {
            path.node.consequent = instrument(path.node.consequent);
          },
        },
        Function: {
          exit(path) {
            const node = path.node;
            const body = node.body;
            // A concise arrow (`x => x * 2`) has an expression body: there are
            // no statements to stop on, so it gets no frame. Converting it to a
            // block would cost every such arrow a probe for nothing.
            if (!t.isBlockStatement(body) || done.has(node)) return;
            done.add(node);
            const params: string[] = [];
            const refs: BabelTypes.Expression[] = [];
            for (const param of node.params) {
              // Only plain identifiers are captured — a destructured or rest
              // parameter has no single name to report, and inventing one would
              // put a confident wrong value in the variables pane.
              if (t.isIdentifier(param)) {
                params.push(param.name);
                refs.push(t.identifier(param.name));
              }
            }
            const localId = entries.length;
            entries.push([
              functionName(path, t),
              fileId,
              node.loc?.start.line ?? 0,
              params,
            ]);
            const pushCall = t.callExpression(t.identifier("__dbg_p"), [
              t.numericLiteral(localId),
              ...(refs.length > 0 ? [t.arrayExpression(refs)] : []),
            ]);
            pendingPushes.push((blockStart: number) => {
              pushCall.arguments[0] = t.numericLiteral(blockStart + localId);
            });
            const push = t.expressionStatement(pushCall);
            done.add(push);
            const pop = t.expressionStatement(
              t.callExpression(t.identifier("__dbg_o"), []),
            );
            done.add(pop);
            // try/finally, not a trailing pop: an exception thrown through an
            // instrumented frame would otherwise desynchronize the shadow stack
            // for the rest of the process's life, and the first thing anyone
            // debugs is a throw.
            const wrapped = t.tryStatement(
              t.blockStatement(body.body),
              null,
              t.blockStatement([pop]),
            );
            done.add(wrapped);
            body.body = [push, wrapped];
          },
        },
      },
    };
  };
}

/** Options for {@link debugProbePlugin}. */
export interface DebugProbeOptions {
  /** Where the bundle is written; the manifest goes to `<outfile>.dbg.json`. */
  outfile?: string | undefined;
  /** Called with the manifest when the build finishes (tests read this instead
   *  of the file). */
  onManifest?: ((manifest: DebugManifest) => void) | undefined;
  /** Instrument this package's own renderer source too. Off by default: a
   *  breakpoint belongs in app code, and instrumenting the renderer roughly
   *  doubles the probe count for frames nobody asked to stop in. */
  includeRenderer?: boolean | undefined;
  /**
   * This package's `src/` directory. Files under it are the RENDERER and are
   * skipped unless {@link DebugProbeOptions.includeRenderer}. Passed in rather
   * than pattern-matched: a workspace checkout resolves the renderer at
   * `js/src` and a registry install at `node_modules/react-watchos/src`, and a
   * pattern loose enough to cover both also swallows a consumer whose own app
   * code happens to live in a directory called `js/src`.
   */
  rendererSrcDir?: string | undefined;
  /**
   * Absolute module paths the virtual inject entry
   * ({@link DEBUG_INJECT_SPECIFIER}) imports, in the order they must EVALUATE.
   * The probe runtime has to come first — `__dbg` must exist before the first
   * instrumented statement, including the ones inside the injected shims.
   *
   * This exists because esbuild's `inject` array is not an evaluation order:
   * with `inject: [probe, shims]` the emitted bundle ran `src/fetch.ts` (a
   * dependency of the shims) before the probe module and died on
   * `__dbg_r is not defined`. One inject whose body is `import a; import b;`
   * makes the order an ESM guarantee instead of an esbuild implementation
   * detail.
   */
  injectModules?: string[] | undefined;
}

/** The specifier the preset puts in `inject` for a debug build. Resolved by
 *  this plugin to a virtual module — see {@link DebugProbeOptions.injectModules}. */
export const DEBUG_INJECT_SPECIFIER = "react-watchos:debug-inject";

/** esbuild namespace for that virtual module. */
const DEBUG_INJECT_NAMESPACE = "react-watchos-debug-inject";

/** The probe runtime and the wire contract it imports — never instrumented
 *  (their own statements would call the probe they are defining). */
const PROBE_MODULE = /src[/\\]debug(?:Probe|Wire)\.ts$/;

/** Normalize separators so a Windows path compares against a POSIX prefix. */
function normalize(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * esbuild plugin: instrument every app source file, and write the file/probe
 * manifest the dev server maps a DAP `source.path` through.
 */
export function debugProbePlugin(options: DebugProbeOptions = {}): Plugin {
  const registry = new DebugRegistry();
  return {
    name: "react-watchos-debug-probe",
    setup(build: PluginBuild) {
      let transformAsyncPromise:
        | Promise<typeof import("@babel/core").transformAsync>
        | undefined;
      const loadTransform = () => {
        transformAsyncPromise ??= import("@babel/core").then(
          (babel) => babel.transformAsync,
          (err) => {
            throw new Error(
              "the debug transform needs Babel installed: npm i -D " +
                "@babel/core @babel/preset-typescript @babel/preset-react",
              { cause: err },
            );
          },
        );
        return transformAsyncPromise;
      };

      build.onResolve(
        { filter: new RegExp(`^${DEBUG_INJECT_SPECIFIER}$`) },
        () => ({ path: DEBUG_INJECT_SPECIFIER, namespace: DEBUG_INJECT_NAMESPACE }),
      );
      build.onLoad(
        { filter: /.*/, namespace: DEBUG_INJECT_NAMESPACE },
        (): OnLoadResult => {
          const modules = options.injectModules ?? [];
          return {
            contents: modules
              .map((module) => `import ${JSON.stringify(module)};`)
              .join("\n"),
            loader: "js",
            // A virtual module has no directory, and without one esbuild
            // refuses even an ABSOLUTE import path ("Could not resolve").
            resolveDir: modules[0] ? dirname(modules[0]) : process.cwd(),
          };
        },
      );

      build.onLoad(
        { filter: /\.[jt]sx?$/ },
        async (args: OnLoadArgs): Promise<OnLoadResult | undefined> => {
          if (PROBE_MODULE.test(args.path)) return undefined;
          const path = normalize(args.path);
          const rendererSrc = options.rendererSrcDir
            ? `${normalize(options.rendererSrcDir).replace(/\/$/, "")}/`
            : undefined;
          const isRenderer =
            rendererSrc !== undefined && path.startsWith(rendererSrc);
          // Third-party code is never instrumented: react + the reconciler are
          // most of the module graph and none of it is code anyone sets a
          // breakpoint in, so probing it would be nearly all of the cost for
          // none of the value.
          if (path.includes("/node_modules/") && !isRenderer) return undefined;
          if (isRenderer && !options.includeRenderer) return undefined;
          const transformAsync = await loadTransform();
          const { readFile } = await import("node:fs/promises");
          const source = await readFile(args.path, "utf8");
          const result = await transformAsync(source, {
            filename: args.path,
            babelrc: false,
            configFile: false,
            // Inline, so esbuild chains it into the bundle's own map and
            // `pnpm symbolicate` still resolves a stack from a debug build.
            sourceMaps: "inline",
            presets: [
              "@babel/preset-typescript",
              [
                "@babel/preset-react",
                { runtime: "automatic", development: false },
              ],
            ],
            plugins: [debugProbeBabelPlugin(registry)],
          });
          return { contents: result?.code ?? source, loader: "js" };
        },
      );

      build.onEnd(async () => {
        const manifest = registry.manifest();
        options.onManifest?.(manifest);
        const outfile = options.outfile ?? build.initialOptions.outfile;
        if (!outfile) return;
        const { writeFile } = await import("node:fs/promises");
        await writeFile(
          `${outfile}.dbg.json`,
          `${JSON.stringify(manifest, null, 2)}\n`,
        );
      });
    },
  };
}
