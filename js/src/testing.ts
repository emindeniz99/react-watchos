// Query helpers for asserting on committed trees, exported as
// `react-watchos/testing`. Pair with `runApp(element, new MemoryHost())`
// (or `renderToTree`) — every consumer was otherwise re-writing `findByType`.
//
// Serialization quirks these helpers account for (see docs/updates.md):
//   - <Text> content folds into `props.text`, not `children`.
//   - function props (onPress, onChange, …) serialize to the literal `true`.

import type { SerializedNode } from "./generated/wire";

/** All nodes of a given type, in document order (depth-first, self first). */
export function findByType(
  node: SerializedNode,
  type: string,
): SerializedNode[] {
  return [
    ...(node.type === type ? [node] : []),
    ...node.children.flatMap((child) => findByType(child, type)),
  ];
}

/**
 * All nodes whose folded text (`props.text`) matches. A string matches by
 * exact equality; a RegExp by `.test()`. Because `<Text>` content lives in
 * `props.text`, this is how you assert on rendered copy.
 */
export function findByText(
  node: SerializedNode,
  text: string | RegExp,
): SerializedNode[] {
  const value = node.props.text;
  const self =
    typeof value === "string" &&
    (typeof text === "string" ? value === text : text.test(value))
      ? [node]
      : [];
  return [
    ...self,
    ...node.children.flatMap((child) => findByText(child, text)),
  ];
}
