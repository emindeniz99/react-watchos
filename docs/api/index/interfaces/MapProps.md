[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / MapProps

# Interface: MapProps

Defined in: [js/src/components.ts:401](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L401)

A MapKit map (watchOS 26): a region with markers and an optional route.

## Extends

- `A11yProps`.`ModifierProps`

## Properties

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:53](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L53)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:52](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L52)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### animation?

> `optional` **animation?**: `object`

Defined in: [js/src/components.ts:92](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L92)

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

Defined in: [js/src/components.ts:406](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L406)

***

### background?

> `optional` **background?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:73](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L73)

Fill color behind the content (rounded when cornerRadius is set).

#### Inherited from

`ModifierProps.background`

***

### cameraTrigger?

> `optional` **cameraTrigger?**: `number`

Defined in: [js/src/components.ts:441](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L441)

A monotonically increasing nudge that re-applies the camera's target
(follow or region). Increment it from a "recenter" button so tapping it
snaps back to the user even after they've panned away — re-issuing the
same follow/region target is otherwise a no-op the map can't observe.

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Defined in: [js/src/components.ts:75](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L75)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### followsUserLocation?

> `optional` **followsUserLocation?**: `boolean`

Defined in: [js/src/components.ts:434](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L434)

Make the camera smoothly track the live location natively
(`MapCameraPosition.userLocation`), instead of you feeding it coordinates.
The `latitude`/`longitude`/`span` region is used as the fallback until the
first fix arrives. Set false to hold a fixed region (e.g. while showing
search results); the user can still pan freely without being yanked back.

***

### frame?

> `optional` **frame?**: `object`

Defined in: [js/src/components.ts:66](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L66)

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

Defined in: [js/src/components.ts:419](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L419)

Fill the whole screen edge-to-edge (ignores the safe area, so the map runs
under the navigation bar and the back chevron floats over it). Use for a
realistic full-screen map; overlay any controls on top with a ZStack.

***

### height?

> `optional` **height?**: `number`

Defined in: [js/src/components.ts:413](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L413)

Fixed map height in points. Ignored when `fullScreen` is set. Defaults to
120 — a small inline map card.

***

### ignoresSafeArea?

> `optional` **ignoresSafeArea?**: `boolean`

Defined in: [js/src/components.ts:85](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L85)

Let this node extend under the safe area (SwiftUI `.ignoresSafeArea()`).
Set it on an overlay stacked on a `fullScreen` map so bottom-anchored
controls reach the physical edge instead of floating above the inset.

#### Inherited from

`ModifierProps.ignoresSafeArea`

***

### latitude?

> `optional` **latitude?**: `number`

Defined in: [js/src/components.ts:403](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L403)

Region center + span (degrees). Defaults to fit the annotations.

***

### longitude?

> `optional` **longitude?**: `number`

Defined in: [js/src/components.ts:404](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L404)

***

### onPress?

> `optional` **onPress?**: () => `void`

Defined in: [js/src/components.ts:447](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L447)

Fired on a single tap on the map (a pan/zoom does NOT fire it). Use it to
toggle overlay chrome for an immersive full-screen map, the way native maps
hide their controls while you explore.

#### Returns

`void`

***

### opacity?

> `optional` **opacity?**: `number`

Defined in: [js/src/components.ts:77](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L77)

0 (invisible) … 1 (opaque).

#### Inherited from

`ModifierProps.opacity`

***

### padding?

> `optional` **padding?**: `number` \| \{ `horizontal?`: `number`; `vertical?`: `number`; \}

Defined in: [js/src/components.ts:64](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L64)

Points on all edges, or per axis: `padding={{horizontal: 8, vertical: 2}}`.

#### Inherited from

`ModifierProps.padding`

***

### route?

> `optional` **route?**: `object`[]

Defined in: [js/src/components.ts:408](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L408)

Polyline route as lat/lon points.

#### lat

> **lat**: `number`

#### lon

> **lon**: `number`

***

### showsUserLocation?

> `optional` **showsUserLocation?**: `boolean`

Defined in: [js/src/components.ts:426](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L426)

Show the device's live location as MapKit's native blue dot (accuracy ring
+ heading), via a `UserAnnotation`. This is the platform's own rendering —
don't hand-roll a marker from a location stream. Needs When-In-Use
location permission (e.g. request it once with `getCurrentLocation()`).

***

### span?

> `optional` **span?**: `number`

Defined in: [js/src/components.ts:405](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L405)

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:79](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L79)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`
