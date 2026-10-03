[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / MapProps

# Interface: MapProps

Defined in: [js/src/components.ts:479](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L479)

A MapKit map (watchOS 26): a region with markers and an optional route.

## Extends

- `A11yProps`.`ModifierProps`

## Properties

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:90](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L90)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:89](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L89)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### animation?

> `optional` **animation?**: `object`

Defined in: [js/src/components.ts:151](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L151)

Animate this node's committed changes (SwiftUI `.animation(_:value:)`):
any prop or subtree change transitions with the given curve instead of
snapping. `duration` in seconds (omit for the curve's default). App
only — widgets are static snapshots and ignore it.

#### duration?

> `optional` **duration?**: `number`

#### kind

> **kind**: `"spring"` \| `"ease"` \| `"easeIn"` \| `"easeOut"` \| `"linear"`

#### Inherited from

`ModifierProps.animation`

***

### annotations?

> `optional` **annotations?**: [`MapAnnotation`](MapAnnotation.md)[]

Defined in: [js/src/components.ts:484](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L484)

***

### background?

> `optional` **background?**: [`Fill`](../type-aliases/Fill.md)

Defined in: [js/src/components.ts:115](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L115)

Colour or gradient behind the content (rounded when cornerRadius is set):
`background="#1C1B18"` or
`background={{ type: "linearGradient", colors: ["indigo", "black"] }}`.

#### Inherited from

`ModifierProps.background`

***

### cameraTrigger?

> `optional` **cameraTrigger?**: `number`

Defined in: [js/src/components.ts:519](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L519)

A monotonically increasing nudge that re-applies the camera's target
(follow or region). Increment it from a "recenter" button so tapping it
snaps back to the user even after they've panned away — re-issuing the
same follow/region target is otherwise a no-op the map can't observe.

***

### containerBackground?

> `optional` **containerBackground?**: [`Fill`](../type-aliases/Fill.md)

Defined in: [js/src/components.ts:125](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L125)

Full-bleed page colour or gradient behind the system chrome (SwiftUI
`.containerBackground(_, for: .tabView)`). Set it on a TabView page, the
direct child of `<TabView>`; elsewhere it has nothing to fill.

**App-only: a no-op in complications and Smart Stack widgets.** The widget
container's background is fixed to clear. Declared in `codegen/schema.ts`
`propDegradations` and listed in `docs/api/capabilities.md`.

#### Inherited from

`ModifierProps.containerBackground`

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Defined in: [js/src/components.ts:134](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L134)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### followsUserLocation?

> `optional` **followsUserLocation?**: `boolean`

Defined in: [js/src/components.ts:512](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L512)

Make the camera smoothly track the live location natively
(`MapCameraPosition.userLocation`), instead of you feeding it coordinates.
The `latitude`/`longitude`/`span` region is used as the fallback until the
first fix arrives. Set false to hold a fixed region (e.g. while showing
search results); the user can still pan freely without being yanked back.

***

### fontDesign?

> `optional` **fontDesign?**: `"default"` \| `"serif"` \| `"rounded"` \| `"monospaced"`

Defined in: [js/src/components.ts:132](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L132)

Type family within the system font (SwiftUI `.fontDesign`): `"serif"` is
New York, `"rounded"` SF Rounded, `"monospaced"` SF Mono. Set on a stack,
it applies to every Text inside; a Text (or nested segment) that sets its
own wins. Works with `textStyle`, so Dynamic Type still applies.

#### Inherited from

`ModifierProps.fontDesign`

***

### frame?

> `optional` **frame?**: `object`

Defined in: [js/src/components.ts:104](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L104)

Fixed and/or max dimensions; `"infinity"` = SwiftUI's fill idiom.

#### height?

> `optional` **height?**: `number`

#### maxHeight?

> `optional` **maxHeight?**: `number` \| `"infinity"`

#### maxWidth?

> `optional` **maxWidth?**: `number` \| `"infinity"`

#### width?

> `optional` **width?**: `number`

#### Inherited from

`ModifierProps.frame`

***

### fullScreen?

> `optional` **fullScreen?**: `boolean`

Defined in: [js/src/components.ts:497](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L497)

Fill the whole screen edge-to-edge (ignores the safe area, so the map runs
under the navigation bar and the back chevron floats over it). Use for a
realistic full-screen map; overlay any controls on top with a ZStack.

***

### height?

> `optional` **height?**: `number`

Defined in: [js/src/components.ts:491](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L491)

Fixed map height in points. Ignored when `fullScreen` is set. Defaults to
120 — a small inline map card.

***

### ignoresSafeArea?

> `optional` **ignoresSafeArea?**: `boolean`

Defined in: [js/src/components.ts:144](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L144)

Let this node extend under the safe area (SwiftUI `.ignoresSafeArea()`).
Set it on an overlay stacked on a `fullScreen` map so bottom-anchored
controls reach the physical edge instead of floating above the inset.

#### Inherited from

`ModifierProps.ignoresSafeArea`

***

### latitude?

> `optional` **latitude?**: `number`

Defined in: [js/src/components.ts:481](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L481)

Region center + span (degrees). Defaults to fit the annotations.

***

### longitude?

> `optional` **longitude?**: `number`

Defined in: [js/src/components.ts:482](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L482)

***

### onPress?

> `optional` **onPress?**: () => `void`

Defined in: [js/src/components.ts:525](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L525)

Fired on a single tap on the map (a pan/zoom does NOT fire it). Use it to
toggle overlay chrome for an immersive full-screen map, the way native maps
hide their controls while you explore.

#### Returns

`void`

***

### opacity?

> `optional` **opacity?**: `number`

Defined in: [js/src/components.ts:136](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L136)

0 (invisible) … 1 (opaque).

#### Inherited from

`ModifierProps.opacity`

***

### padding?

> `optional` **padding?**: `number` \| \{ `horizontal?`: `number`; `vertical?`: `number`; \}

Defined in: [js/src/components.ts:102](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L102)

Points on all edges, or per axis: `padding={{horizontal: 8, vertical: 2}}`.

#### Inherited from

`ModifierProps.padding`

***

### route?

> `optional` **route?**: `object`[]

Defined in: [js/src/components.ts:486](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L486)

Polyline route as lat/lon points.

#### lat

> **lat**: `number`

#### lon

> **lon**: `number`

***

### showsUserLocation?

> `optional` **showsUserLocation?**: `boolean`

Defined in: [js/src/components.ts:504](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L504)

Show the device's live location as MapKit's native blue dot (accuracy ring
+ heading), via a `UserAnnotation`. This is the platform's own rendering —
don't hand-roll a marker from a location stream. Needs When-In-Use
location permission (e.g. request it once with `getCurrentLocation()`).

***

### span?

> `optional` **span?**: `number`

Defined in: [js/src/components.ts:483](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L483)

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:138](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L138)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`
