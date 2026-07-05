import { describe, expect, it } from "vitest";
import { MapView, MemoryHost, WatchRoot } from "../src/index";

describe("Map primitive", () => {
  it("serializes region, annotations and route", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <MapView
        latitude={37.33}
        longitude={-122.03}
        span={0.05}
        height={140}
        annotations={[
          { lat: 37.33, lon: -122.03, title: "Here", systemImage: "mappin" },
        ]}
        route={[
          { lat: 37.33, lon: -122.03 },
          { lat: 37.34, lon: -122.02 },
        ]}
      />,
    );
    const map = host.lastCommit!.root!;
    expect(map.type).toBe("Map");
    expect(map.props).toMatchObject({
      latitude: 37.33,
      longitude: -122.03,
      span: 0.05,
      height: 140,
    });
    expect(map.props.annotations).toEqual([
      { lat: 37.33, lon: -122.03, title: "Here", systemImage: "mappin" },
    ]);
    expect((map.props.route as unknown[]).length).toBe(2);
  });

  it("serializes native user-location + follow props", () => {
    const host = new MemoryHost();
    new WatchRoot(host).render(
      <MapView
        fullScreen
        showsUserLocation
        followsUserLocation
        cameraTrigger={3}
      />,
    );
    const map = host.lastCommit!.root!;
    // These drive MapKit's native UserAnnotation + .userLocation camera — the
    // live blue dot and smooth follow are native, not a JS-streamed marker.
    expect(map.props).toMatchObject({
      fullScreen: true,
      showsUserLocation: true,
      followsUserLocation: true,
      cameraTrigger: 3,
    });
  });
});
