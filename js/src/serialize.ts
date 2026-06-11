import type { SerializedNode, SerializedTree } from "./host";
import type { Container, Instance } from "./renderer";

function textContent(children: unknown): string {
  if (children == null) return "";
  if (Array.isArray(children)) return children.map(textContent).join("");
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
    props.text = textContent(instance.props.children);
  }
  return {
    id: instance.id,
    type: instance.type,
    props,
    children: instance.children.map(serializeInstance),
  };
}

export function serializeTree(container: Container): SerializedTree {
  const root = container.children[0];
  return { v: 1, root: root ? serializeInstance(root) : null };
}
