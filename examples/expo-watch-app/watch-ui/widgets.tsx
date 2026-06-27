import { registerWidget, Storage, Text, VStack } from "react-native-watchos";

// Registered by BOTH bundles (entry.tsx for the app, widget.entry.tsx for the
// extension) so the app can publish these timelines and the extension can also
// render them on its own. The two widget patterns this example showcases:

// 1) STATIC — self-contained content. The widget extension renders it with no
//    running app, and there's nothing to publish; the render reads nothing
//    external, so the complication never changes.
registerWidget({
  kind: "example",
  families: ["accessoryRectangular", "accessoryCircular", "accessoryInline"],
  render: ({ now }) => ({
    entries: [
      { date: now, view: <Text bold>Expo Watch</Text> },
    ],
  }),
});

// 2) DYNAMIC — live data the watch app owns. The app writes "taps" to shared
//    Storage (the App Group) and calls publishWidgets(); this render reads it
//    back, so the complication reflects what you did in the app. The extension
//    shares the same Storage, so the value stays correct even when the app is
//    closed.
registerWidget({
  kind: "taps",
  families: ["accessoryRectangular", "accessoryCircular", "accessoryInline"],
  render: ({ now }) => ({
    entries: [
      {
        date: now,
        view: (
          <VStack>
            <Text size={11} color="secondary">
              Taps
            </Text>
            <Text bold size={20}>
              {String(Storage.get<number>("taps") ?? 0)}
            </Text>
          </VStack>
        ),
      },
    ],
  }),
});
