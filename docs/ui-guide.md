# Writing the UI

How you actually build screens with this renderer: choosing an update
mechanism, theming, navigation and deep links, React-authored complications
and widgets, and the two places the wire model shows through (text formatting
without `Intl`, and optimistic input state).

*(Relocated from the README, 2026-07-29 — unchanged in substance, so the
README can stay a front door. The generated per-export reference is
[docs/api/](./api/README.md); the tested component/host-method tables are
[api/capabilities.md](./api/capabilities.md).)*

## Updating the UI: instant, periodic, smooth

The renderer is pull/event-driven — it commits only when something
re-enters JS, so it costs nothing while idle. Match the mechanism to the
update frequency:

- **Instant** (taps, native pushes): a tap runs at urgent priority and
  flushes synchronously, so the commit happens before the native call
  returns (latency ≈ one display frame). For native state that isn't a tap
  — connectivity, sensors, lifecycle — register a listener with
  `registerNativeListener(name, handler)` and have Swift call
  `model.pushNativeEvent(name, payload)`; it routes through `runSync` so it
  reacts instantly too, instead of on the scheduler's next turn. (Demo: the
  Stopwatch screen's `phase:` footer, pushed from `scenePhase`.)
- **Periodic** (seconds clock, polling): drive it from JS with
  `setTimeout`/`setInterval`, ideally aligned to the boundary.
- **Smooth / high-frequency** (stopwatch, countdown, animated timer): do
  **not** drive it from React — render `<TimerText since={startMs} />` or
  `<TimerText until={endMs} />` once and SwiftUI ticks the digits natively
  (`Text(timerInterval:)`), zero per-frame JS, even while the bundle is
  idle. For a paused value, render a plain `<Text>` with the frozen string.
  Same idea as the widget timelines: hand native the declarative target and
  let it run. (Demo: the Stopwatch screen.)

## Theming (semantic tokens)

Tokens resolve in JS — the wire and the Swift interpreter only ever see
concrete values, so theming needs no native code and is fully testable off-
device. `defaultTheme` uses SwiftUI semantic colors + Dynamic-Type text
styles, so zero config already looks native; `createTheme` overrides one
section at a time.

```tsx
const t = useTheme(); // wrap the app in <ThemeProvider theme={createTheme(...)}> to customize
<VStack spacing={t.space.sm} padding={t.space.md}
        background={t.colors.surface} cornerRadius={t.radius.md}>
  <Text {...t.text.title}>Water</Text>
  <Text {...t.text.muted}>2 of 8 glasses</Text>
</VStack>
```

## Navigation & deep links

Navigation is route-first. Every navigable screen gets a stable path, and
links point to those paths. The Swift host still renders a native
`NavigationStack(path:)`, so pushes, back navigation, and watchOS-native
transitions stay native while React owns the route state.

```tsx
function App() {
  return (
    <NavigationProvider>
      <Routes />
    </NavigationProvider>
  );
}

function Routes() {
  const { path, setPath } = useNavigation();
  return (
    <NavigationStack path={path} onPathChange={setPath}>
      <NavigationRoute path="/" title="React Watch">
        <List>
          <NavigationLink to="/hydration" accessibilityLabel="Hydration">
            <HStack spacing={4}>
              <Image systemName="drop.fill" color="cyan" />
              <Text>Hydration</Text>
            </HStack>
          </NavigationLink>
          <NavigationLink to="/stopwatch" label="Stopwatch" />
        </List>
      </NavigationRoute>

      <NavigationRoute path="/hydration" title="Hydration">
        <HydrationScreen />
      </NavigationRoute>
      <NavigationRoute path="/stopwatch" title="Stopwatch">
        <StopwatchScreen />
      </NavigationRoute>
    </NavigationStack>
  );
}
```

`NavigationLink` requires `to`; `label` is the simple text form, and
children are the custom tappable label/content. Destination screens live in
`NavigationRoute`, never as `NavigationLink` children. For imperative flows
use `const navigate = useNavigate(); navigate("/hydration")`; use
`navigate("/", { action: "reset" })` to return to root. Dynamic segments
(`[id]`, `[...rest]`, `[[...rest]]`) and `useParams()` are documented in the
[package README](../js/README.md#navigation).

The same route table handles external entry points. A widget timeline entry
can publish `url: deepLinkURL("/hydration")`; WidgetKit installs it as
`.widgetURL`, the watch host forwards `.onOpenURL` to JS as `openURL`, and
`NavigationProvider` maps it back to `["/hydration"]`.

**One scheme, no double-config.** The config plugin registers the deep-link
scheme in the watch target's `CFBundleURLTypes`, defaulting to your app's
bundle id (like the App Group) so two apps that both embed this library never
collide on a shared `reactwatch://`. The native host surfaces that exact scheme
to JS (`globalThis.__urlScheme`), so `deepLinkURL()` builds URLs and
`NavigationProvider` parses them from the *same* value — you don't set the
scheme a second time in JS. Override the default with the plugin's `scheme`
option for a shorter custom scheme; `deepLinkURL()`/`getURLScheme()` follow it
automatically.

## Complications & widgets (React-authored)

Watch complications and Smart Stack widgets are WidgetKit accessory
widgets (ClockKit is deprecated). Widget extensions can't run a live app,
so the **watch app's React renders the timelines** and the extension only
displays them:

```tsx
registerWidget({
  kind: "hydration",
  families: ["accessoryCircular", "accessoryRectangular", "accessoryInline"],
  render: ({ family, now }) => ({
    entries: [{
      date: now,
      url: deepLinkURL("/hydration"),
      view: <Gauge value={glasses} max={8} label="Water" />,
    }],
    reloadAfter: now + 24 * 3_600_000,
  }),
});
// after any state change:
publishWidgets();
```

`publishWidgets()` renders every (kind × family) timeline to serialized
trees and hands them to `__host.publishWidgets`, which writes App Group
storage and calls `WidgetCenter.reloadAllTimelines()`. The store is
always written, but the reload is skipped when the new payload matches
the stored one in everything except its timestamp — the extension
already holds that payload, and WidgetKit's refresh budget is the
scarcest thing a publish spends. The
`targets/widget` extension decodes the stored payload in its
`TimelineProvider` and renders it with a static interpreter
(`WidgetNodeView.swift`). The demo hydration tracker drives a circular
gauge complication, a corner gauge, a rectangular Smart Stack card, and
the inline text slot — all from one React render function.

### Widget components render without the reconciler

A timeline entry's `view` is rendered **once**, by a plain element-tree walker
(`js/src/staticRender.ts`), **not** by React's reconciler. A widget component is
therefore a **pure function of its props and the stores it reads**:

- **No effects.** `useEffect`/`useLayoutEffect`/`useInsertionEffect` never run —
  there is no commit for them to run after. Read what you need during render.
- **No state updates.** `useState`/`useReducer` hand back their initial value,
  and calling a setter *during* the render throws: there is no second render to
  produce, so silently dropping the update would be worse. Passing a setter as a
  prop is fine — function props serialize to the literal `true` and are never
  invoked on the widget side. Interaction is an AppIntent (`registerIntent`),
  not a handler in the tree.
- **No `Suspense`, no `lazy()`, no portals.** These throw, naming the offending
  type, instead of quietly rendering something a fiber render wouldn't have.

Everything a static tree *can* honour works, and is asserted against the fiber
path node-for-node (`js/test/staticRender.test.tsx`): function and class
components, `memo`, `forwardRef`, `Fragment`, arrays and keys, conditional and
`null` children, context `Provider`/`Consumer` and `useContext` (so
`ThemeProvider` / `TranslationProvider` work inside a widget), plus `useMemo`,
`useCallback`, `useRef`, `useSyncExternalStore`, `useId` — and the React
Compiler's memo cache, so a compiled component needs no special handling.

**Why**: `react-reconciler` + `scheduler` + the renderer adapter were **83.8% of
the widget bundle** (128,478 B of 153,362 B, minified) and were there only to
mount a fiber tree, commit it once, take a single serialized node and throw the
tree away — no host, no events, no second render. Cutting that edge took the
demo widget bundle from **153,362 B to 27,870 B (−81.8%)**, and in the widget
extension that is 16 MB-of-JS-heap money spent on every timeline request. The
app keeps the real reconciler for its UI; `renderToTree` is the same walker in
both bundles, so the payload the app publishes and the payload the extension
re-renders in-process cannot disagree.

The extension also embeds its own QuickJS (`IntentRuntime.swift`,
measured ~6MB peak vs the ~30MB widget budget, capped at 16MB):

- **Controls (watchOS 26)**: the "Add Glass" Control Center / Action
  button control runs an AppIntent that evaluates the bundle with
  `__entrypoint = "intent"` and dispatches to the handler registered via
  `registerIntent("addGlass", …)` — React updates shared Storage and
  republishes the complications without the app ever opening. Control
  label/symbol/`actionLabel` come from `registerControl(...)` metadata in
  the payload. A second demo control, "Hydration Reminders", is a
  `ControlWidgetToggle`: publishing a `value` is what marks a control a
  toggle, and it should be a **getter** (`value: () => store.enabled`) —
  `registerControl` runs once at startup, so a literal boolean would
  publish the startup state forever and the toggle would draw itself stuck.

  > **`registerControl` re-labels a control; it cannot create one.** A
  > `ControlWidget` is a static Swift type in the widget extension's
  > `@main` `WidgetBundle` — its `kind`, its `AppIntent`, and whether it is
  > a button or a toggle are all compiled in, because WidgetKit discovers
  > controls from that type list before any JS runs. So JS owns the label,
  > symbol, action label and toggle state of a control the consumer has
  > **already declared in Swift**; a `kind` with no matching declaration
  > shows up nowhere, and no `value` can turn a `ControlWidgetButton` into
  > a `ControlWidgetToggle`. This is the same inherent constraint as widget
  > `kind`s, not a limitation of this library.
- **Self-refreshing timelines**: `getTimeline` prefers a fresh in-process
  React render (`__renderWidgets`) over the stored payload.
- **Timelines & relevance**: the daypart demo widget publishes
  future-dated entries (WidgetKit swaps them all day with no process
  running) plus Smart Stack relevance scores per entry.

## Text formatting & translation (there is no `Intl`)

QuickJS ships without the ECMAScript i18n API —
`toLocaleString`/`toLocaleDateString` render a hardcoded US-style format,
and there's no `Intl.NumberFormat`/`DateTimeFormat`. Instead of shipping
ICU, hand native the declarative target: **`<FormattedText>`** renders a
date (`date` + `dateStyle`/`timeStyle`) or a number (`value` +
`format: "decimal" | "percent" | "currency"`) with the device locale via
`DateFormatter`/`NumberFormatter` — the same philosophy as `<TimerText>`.

For message translation, `createTranslations({ resources, fallbackLanguage,
language })` + `<TranslationProvider>` / `useTranslation()` give a typed
`t("key", { name })` with `{placeholder}` interpolation and a pluralization
seam — plain data + one context, resolved in JS so the wire never sees a
key, exactly like the theme layer. Feed it `getDeviceInfo().language`. The
default plural rule is English `one`/`other` (zero-dependency, lean); for
correct plurals in Arabic/Slavic/etc. pass **`pluralRule: cldrPluralRule`**
(canonical CLDR for all ~220 languages via `plurals-cldr`, ~2.7 KB gz, no
`Intl` — it tree-shakes out unless you import it). We compared against
react-i18next / react-intl / Lingui first: all hard-depend on
`Intl.PluralRules`, which QuickJS lacks, so a hand-rolled layer + the one
CLDR data table is the right fit here (see `js/src/i18n.tsx` for the full
rationale).

## Input round-trips (optimistic state)

Toggle/Picker/TextField keep optimistic local state to hide the JS
round-trip, released by a seq-ack protocol — every dispatch carries a
sequence number, every commit acks the highest one processed (`tree.seq`, with
a guaranteed ack commit even when React doesn't re-render), so rapid
interactions can't snap back to stale values.

## See also

- [battery-defaults.md](./battery-defaults.md) — the power policy behind the
  update mechanisms above.
- [updates.md](./updates.md) — what flushes, what doesn't, and the
  serialization quirks that matter when you assert on trees.
- [extending.md](./extending.md) — adding a native capability (ops have a
  documented `getHost()` hatch; views do not — that asymmetry is stated
  there).
- [expo-widgets-comparison.md](./expo-widgets-comparison.md) — how the widget
  story differs from Expo's iOS Widgets SDK.
