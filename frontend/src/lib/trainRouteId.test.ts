import { describe, expect, it } from "vitest";
import type { TrainTrackFeature, TrainTrackProperties } from "@/types/train/tracks";
import { createRouteShortNameLookup } from "./trainRouteId";

const feature = (routeId: string, shortName: string): TrainTrackFeature => ({
  type: "Feature",
  geometry: { type: "LineString", coordinates: [] },
  properties: {
    objectid: 1,
    shape_id: `${routeId}-shape`,
    route_id: routeId,
    agency_id: "SydneyTrains",
    route_short_name: shortName,
    route_long_name: "",
    route_desc: "",
    route_type: "2",
    route_color: "F99D1C",
    route_text_color: "FFFFFF",
    route_type_text: "Rail",
    length: 0,
  } satisfies TrainTrackProperties,
});

const lookup = createRouteShortNameLookup([
  feature("APS_1a", "T8"),
  feature("NSN_1a", "T1"),
  feature("WST_1a", "T1"),
  feature("CTY_S1a", "STH"),
  feature("CTY_NW1a", "NRW"),
]);

describe("createRouteShortNameLookup", () => {
  it("uses the line the route belongs to, not the route id prefix", () => {
    expect(lookup("APS_1a")).toBe("T8");
    expect(lookup("NSN_1a")).toBe("T1");
  });

  it("falls back to other routes sharing the prefix", () => {
    expect(lookup("APS_2f")).toBe("T8");
    expect(lookup("WST_9z")).toBe("T1");
  });

  it("returns nothing when a prefix covers several lines", () => {
    expect(lookup("CTY_S9z")).toBeNull();
  });

  it("returns nothing for unknown or missing route ids", () => {
    expect(lookup("RTTA_DEF")).toBeNull();
    expect(lookup(null)).toBeNull();
    expect(lookup(undefined)).toBeNull();
  });
});
