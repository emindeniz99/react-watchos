[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / RelevantDateKind

# Type Alias: RelevantDateKind

> **RelevantDateKind** = `"default"` \| `"informational"` \| `"scheduled"`

Defined in: [js/src/widgets.ts:66](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/widgets.ts#L66)

How the system should treat a date clue (RelevanceKit `DateKind`,
watchOS 26.0). Omit to let RelevanceKit pick — the older, kind-less
`date(_:)` overload (watchOS 10.0) is used then, so a watch below 26 still
gets the hint.
