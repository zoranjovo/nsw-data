import { Settings } from "luxon";
import { afterEach, describe, expect, it } from "vitest";
import type { StaticStopTime } from "../../types/train/timetable";
import type { TripUpdateStopTime } from "../../types/train/tripUpdates";
import { buildProgress, mergeStopTimeUpdates, toUnixTimestampForSydneyServiceDate } from "./utils";

const SERVICE_DATE = "2026-09-22";
const SERVICE_DAY_START = Date.UTC(2026, 8, 21, 14, 0, 0) / 1000;

const stopTime = (stopSequence: number, arrivalSeconds: number): StaticStopTime => ({
  stopId: `S${stopSequence}`,
  stopSequence,
  arrivalSeconds,
  departureSeconds: arrivalSeconds + 30,
});

const stopUpdate = (
  stopId: string,
  extra: Partial<TripUpdateStopTime> = {}
): TripUpdateStopTime => ({
  stopId,
  stopSequence: null,
  skipped: false,
  noData: false,
  arrivalDelaySeconds: null,
  departureDelaySeconds: null,
  realtimeArrivalTimestamp: null,
  realtimeDepartureTimestamp: null,
  ...extra,
});

const threeStops = [
  stopTime(1, 8 * 3600),
  stopTime(2, 8 * 3600 + 600),
  stopTime(3, 8 * 3600 + 1200),
];

afterEach(() => {
  Settings.now = () => Date.now();
});

describe("toUnixTimestampForSydneyServiceDate", () => {
  it("measures stop times from the start of the service day", () => {
    expect(toUnixTimestampForSydneyServiceDate(SERVICE_DATE, 8 * 3600)).toBe(
      SERVICE_DAY_START + 8 * 3600
    );
  });

  it("keeps times past midnight on the same service day", () => {
    expect(toUnixTimestampForSydneyServiceDate(SERVICE_DATE, 25 * 3600)).toBe(
      SERVICE_DAY_START + 25 * 3600
    );
  });

  it("measures from noon minus 12 hours when daylight saving starts", () => {
    const timestamp = toUnixTimestampForSydneyServiceDate("2026-10-04", 3600) as number;
    expect(new Date(timestamp * 1000).toISOString()).toBe("2026-10-03T14:00:00.000Z");
  });
});

describe("mergeStopTimeUpdates", () => {
  it("carries a delay forward to stops the feed did not update", () => {
    const stops = mergeStopTimeUpdates(
      threeStops,
      [stopUpdate("S1", { arrivalDelaySeconds: 120, departureDelaySeconds: 120 })],
      SERVICE_DATE,
      new Map()
    );

    expect(stops.map((stop) => stop.arrivalDelaySeconds)).toEqual([120, 120, 120]);
    expect(stops.map((stop) => stop.hasRealtimeStopUpdate)).toEqual([true, false, false]);
    expect(stops[2].realtimeArrivalTimestamp).toBe((stops[2].scheduledArrivalTimestamp ?? 0) + 120);
  });

  it("derives a delay when the feed only sends a realtime time", () => {
    const scheduledArrival = SERVICE_DAY_START + 8 * 3600;
    const stops = mergeStopTimeUpdates(
      threeStops,
      [stopUpdate("S1", { realtimeArrivalTimestamp: scheduledArrival + 240 })],
      SERVICE_DATE,
      new Map()
    );

    expect(stops[0].arrivalDelaySeconds).toBe(240);
    expect(stops[1].arrivalDelaySeconds).toBe(240);
  });

  it("flags skipped stops without taking their times from the feed", () => {
    const stops = mergeStopTimeUpdates(
      threeStops,
      [
        stopUpdate("S1", { arrivalDelaySeconds: 60, departureDelaySeconds: 60 }),
        stopUpdate("S2", { skipped: true, arrivalDelaySeconds: 900 }),
      ],
      SERVICE_DATE,
      new Map()
    );

    expect(stops.map((stop) => stop.skipped)).toEqual([false, true, false]);
    expect(stops[1].arrivalDelaySeconds).toBe(60);
  });

  it("stops carrying a delay forward past a stop with no data", () => {
    const stops = mergeStopTimeUpdates(
      threeStops,
      [
        stopUpdate("S1", { arrivalDelaySeconds: 60, departureDelaySeconds: 60 }),
        stopUpdate("S2", { noData: true }),
      ],
      SERVICE_DATE,
      new Map()
    );

    expect(stops.map((stop) => stop.arrivalDelaySeconds)).toEqual([60, null, null]);
  });

  it("matches an update to its stop by sequence when the platform changed", () => {
    const stops = mergeStopTimeUpdates(
      threeStops,
      [stopUpdate("OTHER-PLATFORM", { stopSequence: 2, arrivalDelaySeconds: 300 })],
      SERVICE_DATE,
      new Map()
    );

    expect(stops[1].hasRealtimeStopUpdate).toBe(true);
    expect(stops[1].arrivalDelaySeconds).toBe(300);
  });
});

describe("buildProgress", () => {
  it("never reports a skipped stop as the next stop", () => {
    Settings.now = () => (SERVICE_DAY_START + 8 * 3600 + 60) * 1000;
    const stops = mergeStopTimeUpdates(
      threeStops,
      [stopUpdate("S2", { skipped: true })],
      SERVICE_DATE,
      new Map()
    );

    expect(buildProgress(stops)?.nextStopId).toBe("S3");
  });

  it("treats a late train as still approaching its next stop", () => {
    Settings.now = () => (SERVICE_DAY_START + 8 * 3600 + 700) * 1000;
    const onTime = mergeStopTimeUpdates(threeStops, [], SERVICE_DATE, new Map());
    const late = mergeStopTimeUpdates(
      threeStops,
      [stopUpdate("S1", { arrivalDelaySeconds: 600, departureDelaySeconds: 600 })],
      SERVICE_DATE,
      new Map()
    );

    expect(buildProgress(onTime)?.nextStopId).toBe("S3");
    expect(buildProgress(late)?.nextStopId).toBe("S2");
  });
});
