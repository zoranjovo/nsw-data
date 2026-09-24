import { describe, expect, it } from "vitest";
import type { TimetableData, TimetableStop } from "@/types/train/timetable";
import type { TrainTrackCoordinate, TrainTracksResponse } from "@/types/train/tracks";
import type { TrainPosition } from "@/types/train/train";
import { approxDistanceMeters, METERS_PER_DEGREE } from "./geo";
import { buildTrainMotion, sampleTrainMotion } from "./trainPositionInterpolator";

const BASE_LAT = -33.9;
const BASE_LON = 151.0;
const T0 = 1_790_000_000;
const lonAt = (east: number) =>
  BASE_LON + east / (METERS_PER_DEGREE * Math.cos((BASE_LAT * Math.PI) / 180));
const latAt = (north: number) => BASE_LAT + north / METERS_PER_DEGREE;

const tracks = (coordinates: TrainTrackCoordinate[]): TrainTracksResponse => ({
  type: "FeatureCollection",
  name: "test",
  features: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties: {
        objectid: 1,
        shape_id: "SH",
        route_id: "R",
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
});

const stop = (
  stopSequence: number,
  latitude: number,
  longitude: number,
  arrival: number,
  departure: number
): TimetableStop => ({
  stopId: `S${stopSequence}`,
  stopName: `Stop ${stopSequence}`,
  stopSequence,
  hasRealtimeStopUpdate: false,
  skipped: false,
  latitude,
  longitude,
  scheduledArrival: null,
  scheduledDeparture: null,
  scheduledArrivalSeconds: null,
  scheduledDepartureSeconds: null,
  scheduledArrivalTimestamp: arrival,
  scheduledDepartureTimestamp: departure,
  realtimeArrivalTimestamp: null,
  realtimeDepartureTimestamp: null,
  arrivalDelaySeconds: null,
  departureDelaySeconds: null,
});

const timetable = (stops: TimetableStop[]): TimetableData => ({
  tripId: "T",
  routeId: "R",
  routeShortName: "T1",
  routeLongName: null,
  tripHeadsign: null,
  vehicleId: null,
  cancelled: false,
  tripUpdatesFetchedAt: null,
  staticTimetableFetchedAt: null,
  progress: null,
  stops,
});

const gpsFix = (latitude: number, longitude: number, timestamp: number): TrainPosition => ({
  tripId: "T",
  routeId: "R",
  vehicleId: "V",
  vehicleLabel: "V",
  latitude,
  longitude,
  timestamp,
  bearing: null,
  speed: null,
});

const straightTrack = tracks(
  Array.from({ length: 101 }, (_, index) => [lonAt(index * 100), latAt(0)] as TrainTrackCoordinate)
);

const straightStops = [0, 2000, 4000, 6000, 8000].map((east, index) =>
  stop(index + 1, latAt(0), lonAt(east), T0 + index * 300, T0 + index * 300 + 30)
);

const eastOf = (longitude: number) => approxDistanceMeters(BASE_LAT, BASE_LON, BASE_LAT, longitude);

describe("buildTrainMotion on a route that passes the same place twice", () => {
  const loopTrack = tracks([
    ...Array.from({ length: 31 }, (_, i) => [lonAt(i * 100), latAt(0)] as TrainTrackCoordinate),
    ...Array.from({ length: 3 }, (_, i) => [lonAt(3000), latAt(i * 100)] as TrainTrackCoordinate),
    ...Array.from(
      { length: 31 },
      (_, i) => [lonAt(3000 - i * 100), latAt(200)] as TrainTrackCoordinate
    ),
  ]);
  const loopStops = [
    stop(1, latAt(0), lonAt(0), T0, T0),
    stop(2, latAt(0), lonAt(3000), T0 + 300, T0 + 330),
    stop(3, latAt(80), lonAt(0), T0 + 600, T0 + 600),
  ];

  it("continues around the loop instead of running back down the outbound track", () => {
    const motion = buildTrainMotion(timetable(loopStops), null, loopTrack, "R");
    const sample = sampleTrainMotion(motion as NonNullable<typeof motion>, T0 + 450);

    expect(sample).not.toBeNull();
    expect((sample?.latitude ?? 0) - BASE_LAT).toBeGreaterThan(0.001);
  });

  it("never moves backwards along the route", () => {
    const motion = buildTrainMotion(timetable(loopStops), null, loopTrack, "R");
    let travelled = 0;
    let previous = sampleTrainMotion(motion as NonNullable<typeof motion>, T0);
    for (let time = T0 + 10; time <= T0 + 600; time += 10) {
      const next = sampleTrainMotion(motion as NonNullable<typeof motion>, time);
      travelled += approxDistanceMeters(
        previous?.latitude ?? 0,
        previous?.longitude ?? 0,
        next?.latitude ?? 0,
        next?.longitude ?? 0
      );
      previous = next;
    }

    expect(travelled).toBeGreaterThan(6100);
    expect(travelled).toBeLessThan(6500);
  });
});

describe("buildTrainMotion with a GPS fix", () => {
  it("puts the train where the fix says, not where the timetable says", () => {
    const fix = gpsFix(latAt(0), lonAt(2000), T0 + 600);
    const motion = buildTrainMotion(timetable(straightStops), fix, straightTrack, "R");
    const sample = sampleTrainMotion(motion as NonNullable<typeof motion>, T0 + 600);

    expect(eastOf(sample?.longitude ?? 0)).toBeGreaterThan(1900);
    expect(eastOf(sample?.longitude ?? 0)).toBeLessThan(2100);
  });

  it("delays the stops still to come by however late the fix is", () => {
    const fix = gpsFix(latAt(0), lonAt(2000), T0 + 600);
    const motion = buildTrainMotion(timetable(straightStops), fix, straightTrack, "R");
    const sample = sampleTrainMotion(motion as NonNullable<typeof motion>, T0 + 900);

    expect(eastOf(sample?.longitude ?? 0)).toBeGreaterThan(3900);
    expect(eastOf(sample?.longitude ?? 0)).toBeLessThan(4100);
  });

  it("still uses a fix that arrives after the last scheduled stop", () => {
    const fix = gpsFix(latAt(0), lonAt(6000), T0 + 1500);
    const motion = buildTrainMotion(timetable(straightStops), fix, straightTrack, "R");
    const sample = sampleTrainMotion(motion as NonNullable<typeof motion>, T0 + 1500);

    expect(eastOf(sample?.longitude ?? 0)).toBeGreaterThan(5900);
    expect(eastOf(sample?.longitude ?? 0)).toBeLessThan(6100);
  });
});

describe("buildTrainMotion when the shape does not cover the trip", () => {
  const farStops = [0, 2000, 4000].map((east, index) =>
    stop(index + 1, latAt(20000), lonAt(east), T0 + index * 300, T0 + index * 300 + 30)
  );

  it("snaps stops far from the track onto it", () => {
    const motion = buildTrainMotion(timetable(farStops), null, straightTrack, "R");

    expect(motion?.path).not.toBeNull();
    const sample = sampleTrainMotion(motion as NonNullable<typeof motion>, T0 + 315);
    expect((sample?.latitude ?? 0) - latAt(0)).toBeCloseTo(0, 5);
    expect(sample?.longitude).toBeCloseTo(lonAt(2000), 5);
  });

  it("falls back to straight lines between stops when the route has no track", () => {
    const motion = buildTrainMotion(timetable(farStops), null, straightTrack, "UNKNOWN");

    expect(motion?.path).toBeNull();
    const sample = sampleTrainMotion(motion as NonNullable<typeof motion>, T0 + 150);
    expect((sample?.latitude ?? 0) - latAt(20000)).toBeCloseTo(0, 5);
  });
});
