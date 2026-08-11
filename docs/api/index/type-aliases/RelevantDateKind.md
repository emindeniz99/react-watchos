[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / RelevantDateKind

# Type Alias: RelevantDateKind

> **RelevantDateKind** = `"default"` \| `"informational"` \| `"scheduled"`

Defined in: [js/src/widgets.ts:67](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L67)

How the system should treat a date clue (RelevanceKit `DateKind`,
watchOS 26.0). Omit to let RelevanceKit pick — the older, kind-less
`date(_:)` overload (watchOS 10.0) is used then, so a watch below 26 still
gets the hint.
