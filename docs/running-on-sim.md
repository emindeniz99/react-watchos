# Running the demo on the watchOS simulator

For humans and AI agents who want to see the demo app actually run (level ③ in
[status.md](./status.md)), not just build. **Use the script — do not hand-roll
`xcodebuild`:**

```sh
cd js && pnpm run:watch [SIM_UDID]
```

`SIM_UDID` is optional (defaults to the first booted watchOS sim, else the first
available one, which it boots). The script
([`js/scripts/run-watch-sim.sh`](../js/scripts/run-watch-sim.sh)) builds the JS
bundle, ad-hoc builds the `"React Watch"` scheme, **re-signs the app + widget
for the simulator**, installs and launches, and **asserts the App-Group
entitlement is present** (hard-fails otherwise).

## Why the script exists — the App-Group signing trap

The demo's shared state — the Hydration and Shopping counters, and the
widget/complication that reads them — is backed by an **App Group**
(`group.com.emindeniz99.reactwatch`) via `UserDefaults(suiteName:)`. That is
gated by the `com.apple.security.application-groups` entitlement, and **three
distinct, simulator-specific things strip or deny it.** Each one makes
`counterAdd`/`counterValue` silently read `0`, so a shared-state screen looks
like a renderer/logic bug when it is really an entitlement bug. We re-hit this
repeatedly before writing it down:

1. **`CODE_SIGNING_ALLOWED=NO`** (a "just build it" convenience flag) drops
   **all** entitlements. → Build ad-hoc signed (`CODE_SIGN_IDENTITY="-"`).

2. **`xcodebuild` for the Simulator writes "simulated entitlements"** that keep
   only `get-task-allow` and **drop App Groups** — on device those need a
   provisioning profile, which the sim build has none of. So the built `.app`
   ships an empty `<dict/>` **even though `CODE_SIGN_ENTITLEMENTS` correctly
   resolves to `app/targets/watch/generated.entitlements`**. This is the subtle
   one: the setting is right, the build "succeeds", and the signature still has
   no group. → After building, **manually re-sign** the `.app` *and* its
   embedded widget `.appex` (`.app/PlugIns/*.appex`, inner bundle first) with
   `codesign --force --sign - --entitlements <plist>`. `--entitlements` bypasses
   the simulated-entitlements filtering, and the simulator honors the embedded
   group without a profile.

3. Re-signing **verbatim** with `generated.entitlements` then **fails to
   launch** (`FBSOpenApplicationServiceErrorDomain` / `IOSSHLMainWorkspace`
   denied) because that file carries `com.apple.developer.healthkit` — a
   restricted entitlement SpringBoard refuses without a profile. → Sign with
   **App Group + `get-task-allow`, minus `healthkit`** (the demo's shared state
   doesn't need HealthKit). The script derives this sim-safe entitlement set
   from `generated.entitlements` at run time.

None of this affects a real signed build for a device — it is purely a
simulator quirk. The entitlement is declared correctly in the pbxproj
(`CODE_SIGN_ENTITLEMENTS` + `REGISTER_APP_GROUPS = YES`).

## Verifying it worked

- The script prints `ERROR: re-sign did not embed application-groups` and exits
  non-zero if the group is missing — trust that assertion.
- In-app: open **Hydration**, tap *Add glass* — it should increment and persist
  across navigation.
- On the watch face: a configured complication (e.g. the Groceries list) renders
  the shared value — proof the widget extension reads the same App-Group store
  the app writes. To inspect the container directly, read
  `.../data/Containers/Shared/AppGroup/<uuid>/Library/Preferences/group.com.emindeniz99.reactwatch.plist`
  for `react.storage.*` keys.

## Other notes

- **No Metro / dev server needed.** `boot()` always loads the embedded bundle;
  the DEBUG dev-reload poll (`http://127.0.0.1:8788`) is skipped on its first
  fetch, so a standalone DEBUG build renders the embedded `bundle.js` fine.
- A red **"Could not connect to the server"** overlay on a fresh DEBUG run is
  harmless — it's the DevTools inspector (`startInspector` POSTs snapshots to
  `127.0.0.1:8099` with no `.catch`). Run `pnpm inspector` in `js/` to clear it,
  or build Release.
- Watch app bundle id: `com.emindeniz99.reactwatch.watch` (standalone,
  `WKRunsIndependentlyOfCompanionApp`). `app/App.tsx` is only the **phone**
  companion; the watch UI is the JS bundle under [`js/demo/`](../js/demo/).
