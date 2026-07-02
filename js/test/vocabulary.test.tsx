import { describe, expect, it } from "vitest";
import {
  Button,
  Chart,
  ContentUnavailable,
  Grid,
  GridRow,
  LabeledContent,
  MemoryHost,
  ShareLink,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
  WatchRoot,
} from "../src/index";
import { findByType } from "./helpers";

// The watchOS-9/10 vocabulary batch (Grid/ShareLink/Chart/LabeledContent/
// ContentUnavailable/Toolbar): wire shapes only — the SwiftUI application is
// macOS-build-gated like every native view.

describe("layout & data-display vocabulary", () => {
  it("serializes Grid rows and cells", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <Grid horizontalSpacing={4} verticalSpacing={2}>
        <GridRow>
          <Text>a</Text>
          <Text>b</Text>
        </GridRow>
        <GridRow>
          <Text>c</Text>
        </GridRow>
      </Grid>,
    );
    const grid = findByType(host.lastCommit!.root!, "Grid")[0];
    expect(grid.props).toMatchObject({
      horizontalSpacing: 4,
      verticalSpacing: 2,
    });
    expect(grid.children.map((r) => r.type)).toEqual(["GridRow", "GridRow"]);
    expect(grid.children[0].children.map((c) => c.props.text)).toEqual([
      "a",
      "b",
    ]);
  });

  it("serializes Chart points with numeric and categorical x", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <Chart
        type="bar"
        color="cyan"
        points={[
          { x: "Mon", y: 3 },
          { x: "Tue", y: 5 },
        ]}
      />,
    );
    const chart = findByType(host.lastCommit!.root!, "Chart")[0];
    expect(chart.props).toMatchObject({
      type: "bar",
      color: "cyan",
      points: [
        { x: "Mon", y: 3 },
        { x: "Tue", y: 5 },
      ],
    });
  });

  it("serializes ShareLink, LabeledContent and ContentUnavailable", () => {
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <VStack>
        <ShareLink item="https://example.com" />
        <LabeledContent label="Goal" value="8 glasses" />
        <ContentUnavailable
          title="No workouts"
          systemName="figure.run"
          description="Start one on the Workout app."
        />
      </VStack>,
    );
    const tree = host.lastCommit!.root!;
    expect(findByType(tree, "ShareLink")[0].props.item).toBe(
      "https://example.com",
    );
    expect(findByType(tree, "LabeledContent")[0].props).toMatchObject({
      label: "Goal",
      value: "8 glasses",
    });
    expect(findByType(tree, "ContentUnavailable")[0].props).toMatchObject({
      title: "No workouts",
      systemName: "figure.run",
    });
  });

  it("serializes Toolbar items with placements and interactive children", () => {
    const onAdd = () => {};
    const host = new MemoryHost();
    const root = new WatchRoot(host);
    root.render(
      <VStack>
        <Text>screen</Text>
        <Toolbar>
          <ToolbarItem placement="bottomBar">
            <Button onPress={onAdd}>
              <Text>Add</Text>
            </Button>
          </ToolbarItem>
          <ToolbarItem placement="topBarTrailing">
            <Text>3</Text>
          </ToolbarItem>
        </Toolbar>
      </VStack>,
    );
    const toolbar = findByType(host.lastCommit!.root!, "Toolbar")[0];
    const items = toolbar.children;
    expect(items.map((i) => i.props.placement)).toEqual([
      "bottomBar",
      "topBarTrailing",
    ]);
    expect(items[0].children[0].type).toBe("Button");
    expect(items[0].children[0].props.onPress).toBe(true);
  });
});
