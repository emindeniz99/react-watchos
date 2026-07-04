# Announcement draft (pre-marketing copy)

Working copy for the launch post. Written against the claims-discipline list
in [launch-checklist.md](./launch-checklist.md) §4 — every number cites its
source, and nothing here claims device verification until gate E3 clears.
Update the bracketed gates before publishing; do not publish while any
bracket remains.

---

## Short post (X / HN / r/reactnative)

> **react-watchos — write Apple Watch apps in React, running ON the
> watch.**
>
> JSX + hooks render real SwiftUI. No phone round-trip: QuickJS runs on the
> watch itself, so the app is standalone. Complications and Smart Stack
> widgets are React-authored. OTA updates are Ed25519-signed with
> anti-rollback and crash-loop rollback — and unsigned updates are refused
> by default.
>
> Not a React Native fork (that's impossible on watchOS — no public UIKit,
> no JavaScriptCore); it's the same *category*: a custom reconciler
> streaming JSON trees to a native interpreter, the architecture Raycast
> validated at scale.
>
> npm i react-watchos → Expo config plugin wires the Xcode targets.
> [link]

HN title options (pick one, don't oversell):
- "React for watchOS: JSX driving native SwiftUI, with the JS engine on the watch"
- "Show HN: Write Apple Watch apps in React (QuickJS + SwiftUI, no phone required)"

## Blog-post outline

1. **The hook** — the counter demo GIF (simulator; gate E3 pending, say so
   in the caption). "This is React 19, running in QuickJS, on the watch,
   rendering native SwiftUI."
2. **Why a fork was impossible** — the research.md table (no public UIKit,
   no JSC, no JIT). What we built instead: reconciler → JSON tree →
   SwiftUI interpreter, events + seq-ack back. ~500-line renderer core, not
   a framework fork.
3. **The parts that surprised us** (each links to docs):
   - React-authored complications: the app's React renders WidgetKit
     timelines; the widget extension embeds its own QuickJS (~6 MB measured
     vs a 30 MB budget) for Control-Center intents with the app closed.
   - `TimerText`: high-frequency UI is never driven from JS — hand SwiftUI
     the declarative target and let it tick natively.
   - Signed OTA: Ed25519 with the keyId inside the signed bytes,
     anti-rollback, crash-loop rollback to known-good, boot-time
     re-verification — and refusal as the zero-config default.
   - The design system: 39 primitives + shared modifier props
     (padding/frame/background/…, per-node animation) + a token/theme layer
     that resolves in JS so the native side never sees a token.
4. **Numbers** (sources in launch-checklist §4): 174 KB minified app bundle
   under a 200 KB CI budget; ~2 MB QuickJS heap for the demo app;
   1.06 ms/dispatch on x86 quickjs-ng [replace with on-device number when
   gate E4 clears — until then keep the caveat "x86, CI-class hardware"].
5. **The honest list** — link README Limitations and status.md verbatim:
   not RN core, no RN ecosystem libraries, physical-device path
   [unverified — update when E3 clears], on-device AI blocked on the
   watchOS 27 SDK, Suspense unsupported by design.
6. **Try it** — quickstart (the README consumer path), examples, and the
   architecture review for the deep readers.

## FAQ (prewritten answers for the comment section)

**"Is this React Native?"** In spirit; in code, no — and the README says so
in its second paragraph. No RN core code, no RN ecosystem libraries, no
Yoga. A true port is impossible on watchOS; here's the dependency table
(link research.md).

**"Isn't shipping a JS interpreter against App Store rules?"** Guideline
2.5.2 prohibits *downloading* executable code; interpreting JS *bundled
with the app* is permitted, and our OTA policy restricts updates to
already-reviewed functionality — the native `__host` surface is fixed in
the binary, so an OTA bundle can't gain new native capability. [Gate S4:
first actual submission still untested — keep this phrasing, don't claim
"App Store approved".]

**"What about performance without JIT?"** Apple forbids JIT for everyone —
native apps and us alike. The renderer is pull-driven (idle = zero work),
commits skip serialization when nothing wire-visible changed, high-
frequency UI is delegated to native (`TimerText`), and the React Compiler
is on by default in the build preset. Measured pipeline cost: [E4 number].

**"OTA = remote code execution?"** Only if you misconfigure it on purpose:
unsigned updates are refused unless you explicitly opt in for dev builds;
production requires Ed25519 keys baked into the code-signed binary, the
keyId is inside the signed bytes, downgrades are refused, a crash-looping
bundle rolls back, and stored bundles re-verify at every boot. Threat
model, including what an attacker who controls the manifest URL can and
cannot do, is documented (link ota-signing.md).

**"Why not SolidJS / signals?"** We evaluated it seriously (link the
2026-07-01 review §2.2). Short version: the expensive part is the wire
protocol, not React — the reconciler already exposes the mutation stream a
patch protocol needs, and Raycast ships React + JSON-patch at scale. The
protocol seam is where that evolution happens, without changing the
product's API.

**"Does it work on a real watch?"** [Gate E3 — until it clears:] "Verified
on the watchOS simulator (Xcode build + package tests on the watch arch);
the physical-device path — code signing, App Groups on hardware — is the
documented remaining step." Do not soften this answer.

## Assets to produce before publishing (checklist §4)

- [ ] Counter/hydration demo GIF (simulator capture)
- [ ] Complication updating from the app (gauge fill)
- [ ] Control Center intent with the app closed
- [ ] Dev hot-reload loop (edit App.tsx → simulator updates)
- [ ] Stopwatch (`TimerText`) — emphasize zero per-frame JS
