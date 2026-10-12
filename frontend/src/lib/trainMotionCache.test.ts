import { describe, expect, it } from "vitest";
import { makeStop, makeTimetable, makeTrain } from "@/test/fixtures";
import type { TrainTrackCoordinate, TrainTracksResponse } from "@/types/train/tracks";
import { approxDistanceMeters, METERS_PER_DEGREE } from "./geo";
import { createTrainMotionCache } from "./trainMotionCache";

const BASE_LAT = -33.9;
const BASE_LON = 151.0;
const T0 = 1_790_000_000;
const lonAt = (east: number) =>
  BASE_LON + east / (METERS_PER_DEGREE * Math.cos((BASE_LAT * Math.PI) / 180));
const eastOf = (longitude: number) => approxDistanceMeters(BASE_LAT, BASE_LON, BASE_LAT, longitude);

const tracks: TrainTracksResponse = {
  type: "FeatureCollection",
  name: "test",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: Array.from(
          { length: 81 },
          (_, index) => [lonAt(index * 100), BASE_LAT] as TrainTrackCoordinate
        ),
      },
      properties: {
        objectid: 1,
        shape_id: "SH",
        route_id: "T1",
        agency_id: "SydneyTrains",
        route_short_name: "T1",
        route_long_name: "",
        route_desc: "",
        route_type: "2",
        route_color: "F99D1C",
        route_text_color: "FFFFFF",
        route_type_text: "Rail",
        length: 0,
      },
    },
  ],
};

const stopsAt = (offsetSeconds: number) =>
  [0, 2000, 4000].map((east, index) =>
    makeStop(
      index + 1,
      `Stop ${index + 1}`,
      T0 + offsetSeconds + index * 300,
      T0 + offsetSeconds + index * 300 + 30,
      { latitude: BASE_LAT, longitude: lonAt(east) }
    )
  );

const train = makeTrain("T", { latitude: BASE_LAT, longitude: lonAt(5000), timestamp: T0 });

describe("createTrainMotionCache", () => {
  it("returns nothing until the timetable arrives", () => {
    const cache = createTrainMotionCache();

    expect(cache.sample(train, undefined, tracks, T0)).toBeNull();
    expect(cache.sample(train, makeTimetable("T", stopsAt(0)), tracks, T0)).not.toBeNull();
  });

  it("places the train from the timetable, not its GPS position", () => {
    const cache = createTrainMotionCache();
    const sample = cache.sample(train, makeTimetable("T", stopsAt(0)), tracks, T0 + 165);

    expect(eastOf(sample?.longitude ?? Number.NaN)).toBeCloseTo(1000, 0);
  });

  it("picks up a refreshed timetable", () => {
    const cache = createTrainMotionCache();
    cache.sample(train, makeTimetable("T", stopsAt(0)), tracks, T0 + 165);
    const sample = cache.sample(train, makeTimetable("T", stopsAt(165)), tracks, T0 + 165);

    expect(eastOf(sample?.longitude ?? Number.NaN)).toBeCloseTo(0, 0);
  });

  it("returns nothing for a trip it cannot place on the track", () => {
    const cache = createTrainMotionCache();
    const offTrack = stopsAt(0).map((item) => ({ ...item, latitude: BASE_LAT + 0.1 }));

    expect(cache.sample(train, makeTimetable("T", offTrack), tracks, T0)).toBeNull();
  });
});
