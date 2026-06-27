import { MemoryHost, renderWidgets, runApp, Storage } from "react-native-watchos";
import { findByText, findByType } from "react-native-watchos/testing";
import { describe, expect, it } from "vitest";
import { App } from "../watch-ui/App";
import "../watch-ui/widgets"; // registers the "example" + "taps" widgets

describe("watch UI", () => {
  it("renders the phone-status screen and replies on press", () => {
    const host = new MemoryHost();
    const root = runApp(<App />, host);

    const tree = host.lastCommit?.root;
    if (!tree) throw new Error("no commit");
    expect(findByText(tree, "waiting for phone…")).toHaveLength(1);

    // Pressing the button calls sendToPhone, which no-ops without a native
    // host — it must not throw, and the screen stays mounted.
    const button = findByType(tree, "Button")[0];
    if (!button) throw new Error("no button");
    expect(root.dispatchEvent({ nodeId: button.id, event: "press" })).toBe(true);
  });
});

// The two widget patterns the example showcases. These guard the JS↔Swift `kind`
// contract and the live-data path: if the dynamic render stopped reading Storage
// (or the app stopped writing it), the complication would silently freeze.
describe("widgets", () => {
  it("the taps widget reflects the value the app stored (live data)", () => {
    // The app + the widget's own +/- buttons share an atomic counter (ARCH-05),
    // a separate namespace from get/set.
    Storage.counterAdd("taps", 7, 0, 999);
    const tree =
      renderWidgets(Date.now()).widgets.taps?.accessoryInline?.entries[0]?.tree;
    // VStack > [ Text("Taps"), Text(<count>) ] — the second Text is the value.
    expect(tree?.children?.[1]?.props.text).toBe("7");
  });

  it("the taps widget is interactive on the rectangular family (intent buttons)", () => {
    const tree =
      renderWidgets(Date.now()).widgets.taps?.accessoryRectangular?.entries[0]
        ?.tree;
    // HStack > [ Button(intent dec), VStack, Button(intent inc) ] — each button
    // carries the registerIntent name the extension runs on tap.
    const intents = (tree?.children ?? [])
      .filter((c) => c.type === "Button")
      .map((b) => b.props.intent);
    expect(intents).toEqual(["taps.dec", "taps.inc"]);
  });

  it("the example widget is static content (reads nothing external)", () => {
    const tree =
      renderWidgets(Date.now()).widgets.example?.accessoryInline?.entries[0]
        ?.tree;
    expect(tree?.props.text).toBe("Expo Watch");
  });
});
