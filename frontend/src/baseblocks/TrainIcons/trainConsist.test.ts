import { describe, expect, it } from "vitest";
import { METERS_PER_DEGREE } from "@/lib/geo";
import { carOffsets, consistLayout, placeAlongTrain } from "./trainConsist";

const describeLayout = (fleetCode: string | null, carCount: number | null) =>
  consistLayout(fleetCode, carCount)
    .map((car) => (car.kind === "intermediate" ? "-" : car.reversed ? "<" : ">"))
    .join("");

describe("consistLayout", () => {
  it("builds a fixed Waratah set with cabs only at the ends", () => {
    expect(describeLayout("A", 8)).toBe(">------<");
  });

  it("couples 4-car units for 8-car Tangaras, Millenniums and OSCars", () => {
    expect(describeLayout("T", 8)).toBe(">--<>--<");
    expect(describeLayout("H", 8)).toBe(">--<>--<");
    expect(describeLayout("H", 4)).toBe(">--<");
  });

  it("couples Mariyung 4 and 6-car units", () => {
    expect(describeLayout("D", 10)).toBe(">--<>----<");
    expect(describeLayout("D", 6)).toBe(">----<");
  });

  it("falls back to a sensible length when the feed has no car count", () => {
    expect(consistLayout("B", null)).toHaveLength(8);
    expect(consistLayout(null, null)).toHaveLength(4);
    expect(describeLayout("X", 1)).toBe(">");
  });
});

describe("carOffsets", () => {
  it("lines cars up nose to tail, centred on the train", () => {
    const offsets = carOffsets([
      { front: 10, rear: 10 },
      { front: 10, rear: 10 },
      { front: 12, rear: 8 },
    ]);

    expect(offsets).toEqual([20, 0, -22]);
  });
});

describe("placeAlongTrain", () => {
  it("steps back along the heading when there is no track to follow", () => {
    const placed = placeAlongTrain({ longitude: 151, latitude: -33.8, bearing: 0 }, null, -100);

    expect(placed.longitude).toBeCloseTo(151);
    expect(placed.latitude).toBeCloseTo(-33.8 - 100 / METERS_PER_DEGREE);
    expect(placed.bearing).toBe(0);
  });
});
