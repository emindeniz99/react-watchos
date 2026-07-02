import { WIRE_VERSION } from "./generated/wire";
import type { SerializedNode, SerializedTree } from "./host";
import type { Container, Instance } from "./renderer";

export function textContent(children: unknown): string {
  if (children == null) return "";
  if (Array.isArray(children)) return children.map(textContent).join("");
  // Element children (rich text) serialize as child nodes, not folded text.
  if (typeof children === "object") return "";
  return String(children);
}

export function serializeInstance(instance: Instance): SerializedNode {
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

export function serializeTree(container: Container): SerializedTree {
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
