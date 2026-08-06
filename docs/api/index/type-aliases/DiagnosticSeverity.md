[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / DiagnosticSeverity

# Type Alias: DiagnosticSeverity

> **DiagnosticSeverity** = `"fatal"` \| `"recoverable"` \| `"info"`

Defined in: [js/src/diagnostics.ts:15](https://github.com/emindeniz99/react-watchos/blob/main/js/src/diagnostics.ts#L15)

Structured host diagnostics (ARCH-13). Native reports every host-side
error/notice as a `Diagnostic` record — recorded in an always-on native
ring (last 50, release builds too) — and forwards each one into JS as a
`diagnostic` native event, EXCEPT `js`-subsystem records: those originated
in JS (an onError report), and pushing them back in would let a listener
that throws feed the next error — an echo loop.

Mirrors ReactWatchSupport's `Diagnostic` (Swift); keep the two in sync.
