import { describe, expect, it } from "vitest";
import type { TrainTrackFeature } from "@/types/train/tracks";
import { createRouteColorLookup, hexToRgb } from "./trainRouteColors";

const track = (routeId: string, shortName: string, color: string) =>
  ({
    properties: { route_id: routeId, route_short_name: shortName, route_color: color },
  }) as unknown as TrainTrackFeature;

describe("createRouteColorLookup", () => {
  const colorOf = createRouteColorLookup([
    track("APS_1a", "T8", "E4007C"),
    track("BNK_2a", "T3", ""),
  ]);

  it("uses the track colour for a known route", () => {
    expect(colorOf("APS_1a")).toBe("#E4007C");
  });

  it("matches other variants of the same line by route prefix", () => {
    expect(colorOf("APS_2f")).toBe("#E4007C");
  });

  it("falls back to the line's standard colour when the track has none", () => {
    expect(colorOf("BNK_2a")).toBe("#8B4513");
  });

  it("uses a neutral grey for routes it cannot place", () => {
    expect(colorOf("XYZ_1")).toBe("#999999");
    expect(colorOf(null)).toBe("#999999");
  });
});

describe("hexToRgb", () => {
  it("converts long and short hex colours to 0-1 channels", () => {
    expect(hexToRgb("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb("#fff")).toEqual([1, 1, 1]);
  });

  it("falls back to grey for invalid input", () => {
    expect(hexToRgb("nope")).toEqual([0.6, 0.6, 0.6]);
  });
});
