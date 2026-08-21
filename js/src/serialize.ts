import { WIRE_VERSION } from "./generated/wire";
import type { SerializedNode, SerializedTree } from "./host";

/**
 * The wire-visible shape of one node: everything serialization reads, and
 * nothing else. Two producers build it — the reconciler's `Instance`
 * (renderer.ts, which adds a container back-reference and the rawText flag) and
 * the reconciler-free widget walker (staticRender.ts, which builds plain
 * objects). Narrowing the serializer's input to this shape is what lets BOTH
 * paths run the same `serializeInstance` verbatim, so the wire bytes cannot
 * drift between them.
 */
export interface SerializableNode {
  id: number;
  type: string;
  props: Record<string, unknown>;
  children: SerializableNode[];
}

/** The root slot a commit (or a one-shot walk) collected its top-level nodes in. */
export interface SerializableRoot {
  children: SerializableNode[];
  /** Highest event seq processed; acked on every commit (tree.seq). */
  lastSeq: number;
}

/**
 * A React element child (vs a scalar) — the rich-text trigger. Lives here, not
 * in the renderer, because it is a SERIALIZATION-shape decision: it is what
 * decides whether a <Text>'s children fold into `props.text` or become child
 * nodes. Both render paths consult it (hostConfig.shouldSetTextContent and the
 * static walker) and must agree.
 */
/** The one wording for the raw-text violation. Lives here because BOTH render
 *  paths throw it — the fiber renderer (twice) and the static walker — and a
 *  string literal written per-site is bundled per-site: minification renames
 *  locals, it does not merge identical strings. */
export const RAW_TEXT_ERROR = "Raw text must be wrapped in a <Text> element";

export function hasElementChild(children: unknown): boolean {
  if (Array.isArray(children)) return children.some(hasElementChild);
  return typeof children === "object" && children !== null;
}

export function textContent(children: unknown): string {
  // Match React: null/undefined/booleans render as nothing, so the idiomatic
  // `{cond && "…"}` guard folds to "" (not the literal "false") when cond is off.
  if (children == null || typeof children === "boolean") return "";
  if (Array.isArray(children)) return children.map(textContent).join("");
  // Element children (rich text) serialize as child nodes, not folded text.
  if (typeof children === "object") return "";
  return String(children);
}

function serializeInstance(instance: SerializableNode): SerializedNode {
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(instance.props)) {
    if (key === "children" || value === undefined) continue;
    // Functions can't cross to Swift; a `true` flag tells SwiftUI the
    // node is interactive (e.g. onPress -> tappable).
    props[key] = typeof value === "function" ? true : value;
  }
  if (instance.type === "Text") {
    // Rich text: with element children every segment (raw strings included)
    // is a child instance — folding here too would render the scalars twice.
    props.text =
      instance.children.length === 0
        ? textContent(instance.props.children)
        : "";
  }
  return {
    id: instance.id,
    type: instance.type,
    props,
    children: instance.children.map(serializeInstance),
  };
}

export function serializeTree(container: SerializableRoot): SerializedTree {
  // The watch host renders exactly one root view, so more than one
  // top-level node has nowhere to go. Without this guard children[1..]
  // are silently dropped; fail loud instead.
  if (container.children.length > 1) {
    throw new Error(
      `A watch app must render a single root element (got ${container.children.length}); ` +
        "wrap siblings in a <VStack>/<ZStack> or a single parent.",
    );
  }
  const root = container.children[0];
  return {
    v: WIRE_VERSION,
    seq: container.lastSeq,
    root: root ? serializeInstance(root) : null,
  };
}
