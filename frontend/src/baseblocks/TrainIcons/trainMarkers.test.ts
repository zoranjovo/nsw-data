import { describe, expect, it } from "vitest";
import { makeTrain } from "@/test/fixtures";
import { pickTrainMarker, type TrainMarker, trainIconSizePx } from "./trainMarkers";

const marker = (key: string, longitude: number, latitude: number): TrainMarker => ({
  key,
  position: makeTrain(key),
  fleetCode: null,
  destination: { primary: "Central", secondary: null },
  isSelected: false,
  longitude,
  latitude,
  bearing: null,
  isStale: false,
  isNearView: true,
});

const project = (longitude: number, latitude: number) => ({ x: longitude, y: latitude });

describe("trainIconSizePx", () => {
  it("matches the zoom stops and interpolates between them", () => {
    expect(trainIconSizePx(8)).toBeCloseTo(0.3 * 48);
    expect(trainIconSizePx(12.5)).toBeCloseTo(((0.6 + 0.95) / 2) * 48);
    expect(trainIconSizePx(17)).toBeCloseTo(1.4 * 48);
  });

  it("clamps outside the stops", () => {
    expect(trainIconSizePx(3)).toBeCloseTo(0.3 * 48);
    expect(trainIconSizePx(20)).toBeCloseTo(1.4 * 48);
  });
});

describe("pickTrainMarker", () => {
  it("picks the nearest train within the radius", () => {
    const markers = [marker("far", 30, 0), marker("near", 4, 3), marker("nearest", 1, 1)];

    expect(pickTrainMarker(markers, { x: 0, y: 0 }, 10, project)?.key).toBe("nearest");
  });

  it("returns nothing when every train is outside the radius", () => {
    expect(pickTrainMarker([marker("far", 30, 0)], { x: 0, y: 0 }, 10, project)).toBeNull();
  });
});
