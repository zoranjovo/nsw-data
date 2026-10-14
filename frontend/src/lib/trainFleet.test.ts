import { describe, expect, it } from "vitest";
import { describeTrainFleet } from "./trainFleet";

describe("describeTrainFleet", () => {
  it("names suburban and intercity sets with their letter and length", () => {
    expect(describeTrainFleet({ fleetCode: "H", carCount: 8 })).toEqual({
      kind: "passenger",
      name: "OSCar",
      detail: "H set · 8 cars",
    });
    expect(describeTrainFleet({ fleetCode: "B", carCount: 8 }).name).toBe("Waratah Series 2");
  });

  it("leaves the set letter off regional trains", () => {
    expect(describeTrainFleet({ fleetCode: "X", carCount: 7 })).toEqual({
      kind: "passenger",
      name: "XPT",
      detail: "7 cars",
    });
  });

  it("shows freight as cargo", () => {
    expect(describeTrainFleet({ fleetCode: "W", carCount: null })).toEqual({
      kind: "cargo",
      name: "Cargo",
      detail: null,
    });
    expect(describeTrainFleet({ fleetCode: "G", carCount: 40 }).detail).toBeNull();
  });

  it("falls back to unknown for missing or unrecognised codes", () => {
    expect(describeTrainFleet({ fleetCode: null, carCount: null }).name).toBe("Unknown");
    expect(describeTrainFleet({ fleetCode: "F", carCount: 0 }).name).toBe("Unknown");
    expect(describeTrainFleet({}).name).toBe("Unknown");
  });
});
