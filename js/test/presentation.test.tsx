import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  Alert,
  AlertAction,
  ConfirmationDialog,
  Label,
  List,
  MemoryHost,
  Section,
  Sheet,
  Text,
  VStack,
  WatchRoot,
} from "../src/index";
import { findByType } from "./helpers";

// Presentation surfaces follow the Toggle controlled contract: `presented`
// is the source of truth, the system's dismissal dispatches change(false)
// on the presentation node, and each <AlertAction> is its own node whose
// tap dispatches press — so no new event plumbing exists to drift.

describe("Alert / ConfirmationDialog / Sheet (wire + events)", () => {
  it("serializes the alert with its action children", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <VStack>
        <Alert presented title="Delete item?" message="Cannot be undone.">
          <AlertAction label="Delete" role="destructive" onPress={() => {}} />
          <AlertAction label="Cancel" role="cancel" />
        </Alert>
      </VStack>,
    );
    const alert = findByType(host.lastCommit!.root!, "Alert")[0];
    expect(alert.props).toMatchObject({
      presented: true,
      title: "Delete item?",
      message: "Cannot be undone.",
    });
    const actions = alert.children;
    expect(actions.map((a) => a.type)).toEqual(["AlertAction", "AlertAction"]);
    expect(actions[0].props).toMatchObject({
      label: "Delete",
      role: "destructive",
      onPress: true, // function crossed as an interactivity flag
    });
  });

  it("dispatches an action press and the dismissal change(false)", () => {
    const onDelete = vi.fn();
    function Screen() {
      const [show, setShow] = useState(true);
      return (
        <VStack>
          <Text>{show ? "shown" : "hidden"}</Text>
          <Alert presented={show} title="t" onChange={setShow}>
            <AlertAction label="Delete" onPress={onDelete} />
          </Alert>
        </VStack>
      );
    }
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(<Screen />);
    const action = findByType(host.lastCommit!.root!, "AlertAction")[0];
    const alert = findByType(host.lastCommit!.root!, "Alert")[0];

    // The system button tap: press on the ACTION node…
    expect(
      root.dispatchEvent({ nodeId: action.id, event: "press", seq: 1 }),
    ).toBe(true);
    expect(onDelete).toHaveBeenCalledTimes(1);
    // …then the presentation's binding set(false), like Toggle's change.
    root.dispatchEvent({
      nodeId: alert.id,
      event: "change",
      payload: { value: false },
      seq: 2,
    });
    expect(findByType(host.lastCommit!.root!, "Text")[0].props.text).toBe(
      "hidden",
    );
    expect(host.lastCommit!.seq).toBe(2);
  });

  it("Sheet and ConfirmationDialog use the same controlled contract", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <VStack>
        <Sheet presented onChange={() => {}}>
          <Text>sheet content</Text>
        </Sheet>
        <ConfirmationDialog presented title="Pick" onChange={() => {}}>
          <AlertAction label="One" />
        </ConfirmationDialog>
      </VStack>,
    );
    const sheet = findByType(host.lastCommit!.root!, "Sheet")[0];
    expect(sheet.props).toMatchObject({ presented: true, onChange: true });
    expect(sheet.children[0].props.text).toBe("sheet content");
    const dialog = findByType(host.lastCommit!.root!, "ConfirmationDialog")[0];
    expect(dialog.props.title).toBe("Pick");
  });
});

describe("Section / Label", () => {
  it("serializes grouped list rows and labels", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <List>
        <Section header="Today" footer="3 items">
          <Label label="Water" systemName="drop.fill" color="cyan" />
        </Section>
      </List>,
    );
    const section = findByType(host.lastCommit!.root!, "Section")[0];
    expect(section.props).toMatchObject({ header: "Today", footer: "3 items" });
    const label = findByType(host.lastCommit!.root!, "Label")[0];
    expect(label.props).toMatchObject({
      label: "Water",
      systemName: "drop.fill",
      color: "cyan",
    });
  });
});
