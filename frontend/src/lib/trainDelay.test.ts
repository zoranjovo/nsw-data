import { describe, expect, it } from "vitest";
import type { TimetableData, TimetableStop } from "@/types/train/timetable";
import { currentTrainDelaySeconds, trainDelayLevel } from "./trainDelay";

const stop = (overrides: Partial<TimetableStop>): TimetableStop => ({
  stopId: "s",
  stopName: null,
  stopSequence: 1,
  hasRealtimeStopUpdate: true,
  skipped: false,
  latitude: null,
  longitude: null,
  scheduledArrival: null,
  scheduledDeparture: null,
  scheduledArrivalSeconds: null,
  scheduledDepartureSeconds: null,
  scheduledArrivalTimestamp: null,
  scheduledDepartureTimestamp: null,
  realtimeArrivalTimestamp: null,
  realtimeDepartureTimestamp: null,
  arrivalDelaySeconds: null,
  departureDelaySeconds: null,
  ...overrides,
});

const timetable = (stops: TimetableStop[]) => ({ stops }) as TimetableData;

describe("currentTrainDelaySeconds", () => {
  const stops = [
    stop({ realtimeDepartureTimestamp: 1000, departureDelaySeconds: 60 }),
    stop({
      realtimeArrivalTimestamp: 1200,
      realtimeDepartureTimestamp: 1230,
      arrivalDelaySeconds: 200,
    }),
    stop({ realtimeArrivalTimestamp: 1500, arrivalDelaySeconds: 400 }),
  ];

  it("uses the delay at the next stop the train has not left", () => {
    expect(currentTrainDelaySeconds(timetable(stops), 1100)).toBe(200);
  });

  it("uses the departure delay at the origin", () => {
    expect(currentTrainDelaySeconds(timetable(stops), 900)).toBe(60);
  });

  it("keeps the final stop's delay once the trip has ended", () => {
    expect(currentTrainDelaySeconds(timetable(stops), 2000)).toBe(400);
  });

  it("skips stops the train will not call at", () => {
    const withSkip = [stops[0], { ...stops[1], skipped: true }, stops[2]];
    expect(currentTrainDelaySeconds(timetable(withSkip), 1100)).toBe(400);
  });

  it("has no delay without stops", () => {
    expect(currentTrainDelaySeconds(timetable([]), 1100)).toBeNull();
  });
});

describe("trainDelayLevel", () => {
  it("treats under two minutes, early or unknown as on time", () => {
    expect(trainDelayLevel(null)).toBe(0);
    expect(trainDelayLevel(-60)).toBe(0);
    expect(trainDelayLevel(119)).toBe(0);
  });

  it("marks two to five minutes as a bit late and five plus as late", () => {
    expect(trainDelayLevel(120)).toBe(1);
    expect(trainDelayLevel(299)).toBe(1);
    expect(trainDelayLevel(300)).toBe(2);
  });
});
