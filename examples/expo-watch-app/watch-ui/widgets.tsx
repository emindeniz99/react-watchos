import {
  Button,
  HStack,
  registerIntent,
  registerWidget,
  Storage,
  Text,
  VStack,
} from "react-watchos";

// Registered by BOTH bundles (entry.tsx for the app, widget.entry.tsx for the
// extension) so the app can publish these timelines and the extension can also
// render them — and run the interactive buttons. The patterns this showcases:

// 1) STATIC — self-contained content. The widget extension renders it with no
//    running app, and there's nothing to publish.
registerWidget({
  kind: "example",
  families: ["accessoryRectangular", "accessoryCircular", "accessoryInline"],
  render: ({ now }) => ({
    entries: [{ date: now, view: <Text bold>Expo Watch</Text> }],
  }),
});

// 2) DYNAMIC + INTERACTIVE — the tap count, with +/- buttons right on the
//    complication (watchOS 11+, accessoryRectangular). Each button runs a
//    registered intent in the extension (no app launch); the count is a
//    cross-process-atomic counter (ARCH-05) so the app's "Tap +1" and the
//    widget's buttons can't lose each other's increments.
const TAPS = "taps";
registerIntent(`${TAPS}.inc`, () => Storage.counterAdd(TAPS, 1, 0, 999));
registerIntent(`${TAPS}.dec`, () => Storage.counterAdd(TAPS, -1, 0, 999));

registerWidget({
  kind: TAPS,
  families: ["accessoryRectangular", "accessoryCircular", "accessoryInline"],
  render: ({ now, family }) => {
    const count = String(Storage.counterValue(TAPS));
    // Buttons only fit (and only render interactively) on the rectangular
    // family; the small families show the count alone.
    const view =
      family === "accessoryRectangular" ? (
        <HStack spacing={8}>
          <Button intent={`${TAPS}.dec`}>
            <Text bold size={20}>
              −
            </Text>
          </Button>
          <VStack spacing={0}>
            <Text size={11} color="secondary">
              Taps
            </Text>
            <Text bold size={18}>
              {count}
            </Text>
          </VStack>
          <Button intent={`${TAPS}.inc`}>
            <Text bold size={20}>
              +
            </Text>
          </Button>
        </HStack>
      ) : (
        <VStack>
          <Text size={11} color="secondary">
            Taps
          </Text>
          <Text bold size={20}>
            {count}
          </Text>
        </VStack>
      );
    return { entries: [{ date: now, view }] };
  },
});
