[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / PoiCategory

# Type Alias: PoiCategory

> **PoiCategory** = `"museum"` \| `"musicVenue"` \| `"theater"` \| `"library"` \| `"planetarium"` \| `"school"` \| `"university"` \| `"movieTheater"` \| `"nightlife"` \| `"fireStation"` \| `"hospital"` \| `"pharmacy"` \| `"police"` \| `"castle"` \| `"fortress"` \| `"landmark"` \| `"nationalMonument"` \| `"bakery"` \| `"brewery"` \| `"cafe"` \| `"distillery"` \| `"foodMarket"` \| `"restaurant"` \| `"winery"` \| `"animalService"` \| `"atm"` \| `"automotiveRepair"` \| `"bank"` \| `"beauty"` \| `"evCharger"` \| `"fitnessCenter"` \| `"laundry"` \| `"mailbox"` \| `"postOffice"` \| `"restroom"` \| `"spa"` \| `"store"` \| `"amusementPark"` \| `"aquarium"` \| `"beach"` \| `"campground"` \| `"fairground"` \| `"marina"` \| `"nationalPark"` \| `"park"` \| `"rvPark"` \| `"zoo"` \| `"baseball"` \| `"basketball"` \| `"bowling"` \| `"goKart"` \| `"golf"` \| `"hiking"` \| `"miniGolf"` \| `"rockClimbing"` \| `"skatePark"` \| `"skating"` \| `"skiing"` \| `"soccer"` \| `"stadium"` \| `"tennis"` \| `"volleyball"` \| `"airport"` \| `"carRental"` \| `"conventionCenter"` \| `"gasStation"` \| `"hotel"` \| `"parking"` \| `"publicTransport"` \| `"fishing"` \| `"kayaking"` \| `"surfing"` \| `"swimming"`

Defined in: [js/src/widgets.ts:97](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L97)

A MapKit point-of-interest category, mirroring the Swift member names of
`MKPointOfInterestCategory` (watchOS 6.0+ for the oldest members; the
`poi` clue that consumes them is watchOS 26.0). 73 of the 84 documented
members: the 11 in MapKit's "Type Properties" group (`airportTerminal`,
`scenicView`, `visitorCenter`, …) are watchOS 27.0 **beta** and are
deliberately excluded — declaring a value the current SDK can't compile is
the CX-002/FoundationModels mistake.

Member NAMES, not raw values: `MKPointOfInterestCategory`'s rawValue is an
undocumented Objective-C constant (`MKPOICategory…`), so the Swift side maps
these names to the static members explicitly rather than round-tripping
through `MKPointOfInterestCategory(rawValue:)`. A name this library doesn't
know drops the hint instead of fabricating a category.
