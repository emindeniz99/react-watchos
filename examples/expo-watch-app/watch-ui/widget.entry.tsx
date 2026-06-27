// The WIDGET bundle the watch widget extension evaluates (built by
// scripts/build-targets.mjs into targets/widget/assets/bundle.js). Unlike the
// app bundle (entry.tsx) it does NOT call runApp — it only registers widgets, so
// the extension process stays small and never mounts the app UI.
import { registerWidget, Text, VStack } from "react-native-watchos";

// One complication, kind "example" — matches ExampleWidget in
// targets/widget/ReactWidgets.swift. The widget extension renders this React
// tree (via its embedded QuickJS) and WidgetKit shows the result; for richer
// widgets, publish from the watch app instead and read live data here.
registerWidget({
  kind: "example",
  families: ["accessoryRectangular", "accessoryCircular", "accessoryInline"],
  render: ({ now }) => ({
    entries: [
      {
        date: now,
        view: (
          <VStack>
            <Text bold>Expo Watch</Text>
          </VStack>
        ),
      },
    ],
  }),
});
