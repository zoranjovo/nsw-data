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
  lineColor: [1, 1, 1],
  delayLevel: 0,
  carCount: null,
  track: null,
});

const centreOf = (m: TrainMarker) => [{ x: m.longitude, y: m.latitude }];

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

    expect(pickTrainMarker(markers, { x: 0, y: 0 }, 10, centreOf)?.key).toBe("nearest");
  });

  it("returns nothing when every train is outside the radius", () => {
    expect(pickTrainMarker([marker("far", 30, 0)], { x: 0, y: 0 }, 10, centreOf)).toBeNull();
  });

  it("picks a train by any of its points, such as its rear car", () => {
    const train = marker("long", 100, 0);
    const cars = () => [
      { x: 100, y: 0 },
      { x: 3, y: 0 },
    ];

    expect(pickTrainMarker([train], { x: 0, y: 0 }, 10, cars)?.key).toBe("long");
  });
});
