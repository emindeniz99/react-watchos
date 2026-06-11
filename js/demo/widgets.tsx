import {
  Gauge,
  HStack,
  Image,
  ProgressView,
  Text,
  VStack,
  registerWidget,
} from "../src/index";
import { hydrationStore } from "./hydrationStore";

/**
 * Hydration complication. One React render function covers every
 * accessory family (circular and corner complications, the rectangular
 * Smart Stack widget, and the inline text slot). The app re-publishes on
 * every change; reloadAfter asks WidgetKit for a daily refresh anyway.
 */
export function registerDemoWidgets(): void {
  registerWidget({
    kind: "hydration",
    families: [
      "accessoryCircular",
      "accessoryCorner",
      "accessoryRectangular",
      "accessoryInline",
    ],
    render: ({ family, now }) => {
      const { glasses, goal } = hydrationStore;
      const view = (() => {
        switch (family) {
          case "accessoryCircular":
          case "accessoryCorner":
            return (
              <Gauge
                value={glasses}
                min={0}
                max={goal}
                label="Water"
                style="circular"
              />
            );
          case "accessoryRectangular":
            return (
              <VStack spacing={2}>
                <HStack spacing={4}>
                  <Image systemName="drop.fill" color="cyan" />
                  <Text bold>Hydration</Text>
                </HStack>
                <Text size={12}>{`${glasses} of ${goal} glasses`}</Text>
                <ProgressView value={glasses} total={goal} />
              </VStack>
            );
          case "accessoryInline":
            return <Text>{`Water ${glasses}/${goal}`}</Text>;
        }
      })();
      return {
        entries: [{ date: now, view }],
        reloadAfter: now + 24 * 3_600_000,
      };
    },
  });
}
