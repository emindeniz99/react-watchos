[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ColorValue

# Type Alias: ColorValue

> **ColorValue** = [`SystemColorName`](SystemColorName.md) \| `` `#${string}` ``

Defined in: [js/src/components.ts:44](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L44)

A color prop value (design-system Tier 1, borrowed from Restyle's typed-token
idea): a [SystemColorName](SystemColorName.md) — autocompleted, and a misspelled name is a
compile error — or a `#RRGGBB`/`#RRGGBBAA` hex string. Pure types, zero
runtime bytes and no wire change (the interpreter still parses a plain
string). A computed non-hex color (rare) needs `as ColorValue` or a theme
token; that friction is the price of catching the common name typo.
