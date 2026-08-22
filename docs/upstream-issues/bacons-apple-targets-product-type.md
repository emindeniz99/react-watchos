# Upstream issue draft: @bacons/apple-targets one-target-per-product-type

**Status: DRAFT — not yet filed.** Everything below the horizontal rule is the
proposed issue body, ready to paste.

**Where to file:** <https://github.com/EvanBacon/expo-apple-targets> (the
`repository` field of the `@bacons/apple-targets` npm package).

**Provenance of every claim** (verified 2026-08-22):

- The lookup code was confirmed by reading the **published** npm packages:
  `build/with-xcode-changes.js` line 65 in 5.0.0 (`latest`) and line 64 in
  4.0.7 — byte-for-byte the same statement in both, i.e. unchanged across the
  4 → 5 major.
- The two-same-type-targets behavior in the repro section is **derived from
  that code path** (the `?? targets[0]` fallback plus the "already exists,
  updating" branch); we have not scaffolded a two-widget project to run it
  end-to-end.
- The name-collision incident is a real field report from the first registry
  consumer of our Expo plugin (app and watch target both named "FlareLog"),
  recorded in this repo in commit `b7e2480` ("fix(plugin): refuse a watch
  target named exactly like the app"), the guard in
  [`js/plugin/index.cts`](../../js/plugin/index.cts) and its test in
  [`js/test/plugin.test.ts`](../../js/test/plugin.test.ts). One gap, flagged
  rather than papered over: the exact `TypeError` text from that prebuild
  crash was not preserved — the draft says so instead of inventing it.

---

## Title

`with-xcode-changes falls back to the first target of the same product type — a second same-type target silently rewrites the first instead of being created`

## Environment

- `@bacons/apple-targets` 5.0.0 (npm `latest`); the identical lookup ships in
  4.0.7, so this is not a 5.x regression
- Observed through `npx expo prebuild -p ios` on an Expo SDK app (the config
  plugin runs in Node; the behavior is host-OS independent)

## The code

`build/with-xcode-changes.js`, `applyXcodeChanges` (line 65 in 5.0.0, line 64
in 4.0.7; compiled from the plugin's TypeScript source):

```js
function getExtensionTargets() {
    return project.rootObject.props.targets.filter((target) => {
        return (xcode_1.PBXNativeTarget.is(target) && (0, target_1.isNativeTargetOfType)(target, props.type));
    });
}
const targets = getExtensionTargets();
const productName = props.productName;
let targetToUpdate = (_a = targets.find((target) => target.props.productName === productName)) !== null && _a !== void 0 ? _a : targets[0];
if (targetToUpdate) {
    (0, util_1.warnOnce)(`Target "${targetToUpdate.props.productName}" already exists, updating instead of creating a new one`);
}
```

The candidate set is filtered **only by product type**, and when no target
matches the requested `productName` the lookup falls back to `targets[0]` —
the first existing target of that type — and proceeds to *update* it. The
effect is a hard "one target per product type" limit that nothing enforces or
reports:

## Actual behavior

1. **Two configured targets of the same product type** (e.g. two widgets under
   `targets/`, distinct product names): the first pass creates target A;
   the second pass's name lookup finds nothing, the `?? targets[0]` fallback
   selects target A anyway, prints
   `Target "A" already exists, updating instead of creating a new one`,
   and rewrites A with B's configuration. B is never created; A is corrupted.
   (Derived from the code above — the fallback makes this the only possible
   outcome for a second same-type target.)
2. **A target named exactly like an existing target** collides through the
   by-name `find` itself. Field report: the first consumer of our watchOS
   plugin named both the Expo app and the watch target `FlareLog`;
   `npx expo prebuild -p ios` crashed with a `TypeError` deep in
   `with-xcode-changes`. Observed on 4.x; our root-cause analysis at the time
   attributed it to this lookup selecting the wrong same-name target and
   trying to convert it. (Exact `TypeError` text not preserved — reproduce by
   giving a watch target the app's own name.)

## Expected behavior

Either of:

- Support several targets per product type: match strictly by `productName`
  and **create** a new target when nothing matches, never adopt an unrelated
  target; or
- If one-per-type is an intentional constraint, fail loudly when a second
  same-type target is configured — an error naming both targets — instead of
  mutating the first one and continuing.

Silently "updating" a target the config never referred to corrupts the Xcode
project in ways that surface far from the cause (codesigning, plists, build
phases of the clobbered target).

## Minimal repro

1. `npx create-expo-app repro && cd repro`, install `@bacons/apple-targets`
   and add its config plugin per the README.
2. Create two same-type targets, e.g. `targets/widget-a/expo-target.config.js`
   and `targets/widget-b/expo-target.config.js`, both `type: "widget"`, with
   distinct names.
3. `npx expo prebuild -p ios --clean`, then open `ios/*.xcodeproj`: there is
   one widget target, carrying widget-b's configuration, and the prebuild log
   shows `Target "widget-a" already exists, updating instead of creating a new
   one`.

For the name-collision variant: give a watch target the same name as the app
itself and run the same prebuild.

## Workaround we carry meanwhile

Our Expo config plugin refuses the configuration that triggered the field
crash before apple-targets ever runs — `resolveOptions` throws when the watch
target name equals the app's own name, with the fix in the error text (pass a
distinct `name`, e.g. `"<App> Watch"`). And by convention we configure at most
one target per product type. That guards our consumers, but the
first-of-type fallback itself is upstream's to fix.
