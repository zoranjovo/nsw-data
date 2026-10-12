import { describe, expect, it } from "vitest";
import type { TimetableData, TimetableStop } from "@/types/train/timetable";
import type { TrainTrackCoordinate, TrainTracksResponse } from "@/types/train/tracks";
import { approxDistanceMeters, METERS_PER_DEGREE } from "./geo";
import {
  buildTrainMotion,
  type InterpolatedTrainPosition,
  sampleTrainMotion,
  type TrainMotion,
} from "./trainPositionInterpolator";

const BASE_LAT = -33.9;
const BASE_LON = 151.0;
const T0 = 1_790_000_000;
const lonAt = (east: number) =>
  BASE_LON + east / (METERS_PER_DEGREE * Math.cos((BASE_LAT * Math.PI) / 180));
const latAt = (north: number) => BASE_LAT + north / METERS_PER_DEGREE;
const eastOf = (longitude: number) => approxDistanceMeters(BASE_LAT, BASE_LON, BASE_LAT, longitude);
const northOf = (latitude: number) => (latitude - BASE_LAT) * METERS_PER_DEGREE;

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

const straightTrack = tracks(
  Array.from({ length: 101 }, (_, index) => [lonAt(index * 100), latAt(0)] as TrainTrackCoordinate)
);

const straightStops = [0, 2000, 4000, 6000, 8000].map((east, index) =>
  stop(index + 1, latAt(0), lonAt(east), T0 + index * 300, T0 + index * 300 + 30)
);

const motionFor = (stops: TimetableStop[], track = straightTrack) =>
  buildTrainMotion(timetable(stops), track, "R") as TrainMotion;

const expectValid = (sample: InterpolatedTrainPosition) => {
  expect(Number.isFinite(sample.latitude)).toBe(true);
  expect(Number.isFinite(sample.longitude)).toBe(true);
  expect(sample.bearing).toBeGreaterThanOrEqual(0);
  expect(sample.bearing).toBeLessThan(360);
};

describe("buildTrainMotion", () => {
  it("keeps the train at a station between its arrival and departure", () => {
    const motion = motionFor(straightStops);

    expect(eastOf(sampleTrainMotion(motion, T0 + 300).longitude)).toBeCloseTo(2000, 0);
    expect(eastOf(sampleTrainMotion(motion, T0 + 315).longitude)).toBeCloseTo(2000, 0);
    expect(eastOf(sampleTrainMotion(motion, T0 + 330).longitude)).toBeCloseTo(2000, 0);
  });

  it("moves the train along the track in step with the time between stations", () => {
    const motion = motionFor(straightStops);

    expect(eastOf(sampleTrainMotion(motion, T0 + 165).longitude)).toBeCloseTo(1000, 0);
    expect(eastOf(sampleTrainMotion(motion, T0 + 397.5).longitude)).toBeCloseTo(2500, 0);
  });

  it("points the train the way it is travelling, including while it waits at a station", () => {
    const motion = motionFor(straightStops);

    expect(sampleTrainMotion(motion, T0 + 165).bearing).toBeCloseTo(90, 0);
    expect(sampleTrainMotion(motion, T0 + 315).bearing).toBeCloseTo(90, 0);
    expect(sampleTrainMotion(motion, T0 - 100).bearing).toBeCloseTo(90, 0);
  });

  it("follows the bends in the track rather than a straight line between stations", () => {
    const bend = tracks([
      ...Array.from({ length: 11 }, (_, i) => [lonAt(i * 100), latAt(0)] as TrainTrackCoordinate),
      ...Array.from(
        { length: 10 },
        (_, i) => [lonAt(1000), latAt((i + 1) * 100)] as TrainTrackCoordinate
      ),
    ]);
    const stops = [
      stop(1, latAt(0), lonAt(0), T0, T0),
      stop(2, latAt(1000), lonAt(1000), T0 + 200, T0 + 200),
    ];
    const sample = sampleTrainMotion(motionFor(stops, bend), T0 + 100);

    expect(eastOf(sample.longitude)).toBeCloseTo(1000, 0);
    expect(northOf(sample.latitude)).toBeCloseTo(0, 0);
  });

  it("waits at the first stop before the trip and at the last stop after it", () => {
    const motion = motionFor(straightStops);

    expect(eastOf(sampleTrainMotion(motion, T0 - 9999).longitude)).toBeCloseTo(0, 0);
    expect(eastOf(sampleTrainMotion(motion, T0 + 9999).longitude)).toBeCloseTo(8000, 0);
  });

  it("follows a track drawn in the opposite direction to travel", () => {
    const reversed = tracks(
      Array.from(
        { length: 101 },
        (_, index) => [lonAt(10000 - index * 100), latAt(0)] as TrainTrackCoordinate
      )
    );
    const sample = sampleTrainMotion(motionFor(straightStops, reversed), T0 + 165);

    expect(eastOf(sample.longitude)).toBeCloseTo(1000, 0);
    expect(sample.bearing).toBeCloseTo(90, 0);
  });

  it("goes around a route that passes the same place twice instead of doubling back", () => {
    const outAndBack = tracks([
      ...Array.from({ length: 31 }, (_, i) => [lonAt(i * 100), latAt(0)] as TrainTrackCoordinate),
      ...Array.from(
        { length: 31 },
        (_, i) => [lonAt(3000 - i * 100), latAt(50)] as TrainTrackCoordinate
      ),
    ]);
    const stops = [
      stop(1, latAt(0), lonAt(0), T0, T0),
      stop(2, latAt(0), lonAt(3000), T0 + 300, T0 + 330),
      stop(3, latAt(50), lonAt(0), T0 + 630, T0 + 630),
    ];
    const sample = sampleTrainMotion(motionFor(stops, outAndBack), T0 + 480);

    expect(northOf(sample.latitude)).toBeCloseTo(50, 0);
    expect(eastOf(sample.longitude)).toBeCloseTo(1525, 0);
    expect(sample.bearing).toBeCloseTo(270, 0);
  });

  it("starts at the first visit to a station the trip loops back through", () => {
    const side = (count: number, point: (step: number) => [number, number]) =>
      Array.from({ length: count }, (_, step) => {
        const [east, north] = point(step);
        return [lonAt(east), latAt(north)] as TrainTrackCoordinate;
      });
    const loopThenOut = tracks([
      ...side(10, (step) => [step * 100, 0]),
      ...side(10, (step) => [1000, step * 100]),
      ...side(10, (step) => [1000 - step * 100, 1000]),
      ...side(10, (step) => [0, 1000 - step * 100]),
      ...side(31, (step) => [-step * 100, 0]),
    ]);
    const stops = [
      stop(1, latAt(0), lonAt(0), T0, T0),
      stop(2, latAt(1000), lonAt(1000), T0 + 200, T0 + 200),
      stop(3, latAt(0), lonAt(0), T0 + 400, T0 + 400),
      stop(4, latAt(0), lonAt(-3000), T0 + 700, T0 + 700),
    ];
    const motion = motionFor(stops, loopThenOut);

    expect(eastOf(sampleTrainMotion(motion, T0 + 100).longitude)).toBeCloseTo(1000, 0);
    expect(northOf(sampleTrainMotion(motion, T0 + 100).latitude)).toBeCloseTo(0, 0);
    expect(northOf(sampleTrainMotion(motion, T0 + 300).latitude)).toBeCloseTo(1000, 0);
    expect(eastOf(sampleTrainMotion(motion, T0 + 550).longitude)).toBeCloseTo(1500, 0);
  });

  it("skips stops the train does not call at", () => {
    const stops = straightStops.map((item, index) =>
      index === 1 ? { ...item, skipped: true } : item
    );

    expect(eastOf(sampleTrainMotion(motionFor(stops), T0 + 315).longitude)).toBeCloseTo(2000, 0);
  });

  it("uses another route's track when the trip's own route has none that fits", () => {
    const sample = sampleTrainMotion(
      buildTrainMotion(timetable(straightStops), straightTrack, "OTHER") as TrainMotion,
      T0 + 165
    );

    expect(eastOf(sample.longitude)).toBeCloseTo(1000, 0);
  });

  it("uses whichever of a route's shapes the trip runs along", () => {
    const branch = tracks(
      Array.from(
        { length: 101 },
        (_, index) => [lonAt(0), latAt(index * 100)] as TrainTrackCoordinate
      )
    );
    const branches: TrainTracksResponse = {
      ...straightTrack,
      features: [...branch.features, ...straightTrack.features],
    };

    for (const routeId of ["R", "OTHER"]) {
      const motion = buildTrainMotion(timetable(straightStops), branches, routeId) as TrainMotion;
      expect(eastOf(sampleTrainMotion(motion, T0 + 165).longitude)).toBeCloseTo(1000, 0);
    }
  });

  it("returns nothing when a stop is not on the track, rather than drawing the train off it", () => {
    const stops = straightStops.map((item, index) =>
      index === 2 ? { ...item, latitude: latAt(5000) } : item
    );

    expect(buildTrainMotion(timetable(stops), straightTrack, "R")).toBeNull();
  });

  it("returns nothing when no stop has a location", () => {
    const stops = straightStops.map((item) => ({ ...item, latitude: null, longitude: null }));

    expect(buildTrainMotion(timetable(stops), straightTrack, "R")).toBeNull();
  });

  it("smooths over short zigzags where the track shape doubles back on itself", () => {
    const zigzag = tracks([
      [lonAt(14), latAt(0)],
      ...Array.from({ length: 101 }, (_, index) => {
        const east = index * 100;
        return [lonAt(index === 30 ? east - 7 : east), latAt(0)] as TrainTrackCoordinate;
      }).flatMap((point, index) =>
        index === 50 ? [point, [lonAt(4900), latAt(0)] as TrainTrackCoordinate] : [point]
      ),
    ]);
    const motion = motionFor(straightStops, zigzag);
    let previous = -Infinity;
    for (let time = T0 - 10; time <= T0 + 1300; time += 0.5) {
      const sample = sampleTrainMotion(motion, time);
      expect(sample.bearing).toBeCloseTo(90, 0);
      expect(eastOf(sample.longitude)).toBeGreaterThanOrEqual(previous - 0.01);
      previous = eastOf(sample.longitude);
    }
  });
});

describe("buildTrainMotion with realtime delays", () => {
  const late =
    (delay: number) =>
    (item: TimetableStop): TimetableStop => ({
      ...item,
      hasRealtimeStopUpdate: true,
      realtimeArrivalTimestamp: (item.scheduledArrivalTimestamp ?? 0) + delay,
      realtimeDepartureTimestamp: (item.scheduledDepartureTimestamp ?? 0) + delay,
      arrivalDelaySeconds: delay,
      departureDelaySeconds: delay,
    });

  it("uses the realtime times for the stops that have them", () => {
    const motion = motionFor(straightStops.map(late(120)));

    expect(eastOf(sampleTrainMotion(motion, T0 + 120 + 165).longitude)).toBeCloseTo(1000, 0);
  });

  it("carries the delay back to stops that no longer have realtime updates", () => {
    const stops = straightStops.map((item, index) => (index < 2 ? item : late(120)(item)));
    const motion = motionFor(stops);

    expect(eastOf(sampleTrainMotion(motion, T0 + 330 + 120 + 135).longitude)).toBeCloseTo(3000, 0);
  });

  it("carries a reported delay on to later stops without their own update", () => {
    const stops = straightStops.map((item, index) =>
      index === 0 ? late(120)(item) : index === 3 ? late(0)(item) : item
    );

    expect(eastOf(sampleTrainMotion(motionFor(stops), T0 + 440).longitude)).toBeCloseTo(2000, 0);
  });
});

describe("buildTrainMotion with messy timetables", () => {
  it("never runs backwards when a stop time is out of order", () => {
    const stops = straightStops.map((item, index) =>
      index === 3
        ? { ...item, scheduledArrivalTimestamp: T0 + 100, scheduledDepartureTimestamp: T0 + 100 }
        : item
    );
    const motion = motionFor(stops);
    let previous = -Infinity;
    for (let time = T0 - 10; time <= T0 + 1300; time += 5) {
      const sample = sampleTrainMotion(motion, time);
      expectValid(sample);
      expect(eastOf(sample.longitude)).toBeGreaterThanOrEqual(previous - 0.01);
      previous = eastOf(sample.longitude);
    }
  });

  it("copes with every stop at the same time", () => {
    const motion = motionFor(
      straightStops.map((item) => ({
        ...item,
        scheduledArrivalTimestamp: T0,
        scheduledDepartureTimestamp: T0,
      }))
    );

    expectValid(sampleTrainMotion(motion, T0 - 1));
    expectValid(sampleTrainMotion(motion, T0));
    expectValid(sampleTrainMotion(motion, T0 + 1));
  });

  it("always gives a valid position that only moves forward along the track", () => {
    let seed = 7;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    const coordinates = Array.from({ length: 300 }, (_, index) => {
      const angle = index / 40;
      return [
        lonAt(Math.cos(angle) * 3000),
        latAt(Math.sin(angle) * 3000 + index * 5),
      ] as TrainTrackCoordinate;
    });
    const curvy = tracks(coordinates);

    for (let run = 0; run < 300; run++) {
      const stopCount = 1 + Math.floor(random() * 8);
      const stops = Array.from({ length: stopCount }, (_, index) => {
        const [longitude, latitude] =
          coordinates[Math.floor(((index + random()) / stopCount) * 299)];
        const arrival = T0 + index * 200 + (random() < 0.1 ? (random() - 0.5) * 2000 : 0);
        const departure = arrival + (random() < 0.1 ? -50 : random() * 60);
        const delay = random() < 0.5 ? Math.round((random() - 0.3) * 600) : null;
        return {
          ...stop(index + 1, latitude + (random() - 0.5) * 0.001, longitude, arrival, departure),
          latitude: random() < 0.05 ? null : latitude + (random() - 0.5) * 0.001,
          skipped: random() < 0.05,
          scheduledArrivalTimestamp: random() < 0.05 ? null : arrival,
          hasRealtimeStopUpdate: delay != null,
          realtimeArrivalTimestamp: delay != null ? arrival + delay : null,
          realtimeDepartureTimestamp: delay != null ? departure + delay : null,
          arrivalDelaySeconds: delay,
          departureDelaySeconds: delay,
        };
      });
      const motion = buildTrainMotion(timetable(stops), curvy, "R");
      if (motion == null) continue;

      for (let index = 1; index < motion.times.length; index++) {
        expect(motion.times[index]).toBeGreaterThanOrEqual(motion.times[index - 1]);
        expect(
          motion.direction * (motion.distances[index] - motion.distances[index - 1])
        ).toBeGreaterThanOrEqual(0);
      }
      for (let time = T0 - 300; time < T0 + 2500; time += 13) {
        expectValid(sampleTrainMotion(motion, time));
      }
    }
  });
});
