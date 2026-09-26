import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { describe, expect, it } from "vitest";
import type { TripUpdateEntry, TripUpdateStopTime } from "../../types/train/tripUpdates";
import { mergeTripUpdateEntries, toTripUpdates } from "./utils";

const rt = GtfsRealtimeBindings.transit_realtime;

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

const entry = (
  stopTimeUpdates: TripUpdateStopTime[],
  serviceDate: string | null = "2026-09-22"
): TripUpdateEntry => ({
  tripId: "T",
  routeId: "APS_1a",
  vehicleId: null,
  serviceDate,
  cancelled: false,
  stopTimeUpdates,
});

const decodeFeed = (entities: object[]) =>
  rt.FeedMessage.decode(
    rt.FeedMessage.encode({
      header: { gtfsRealtimeVersion: "2.0" },
      entity: entities,
    }).finish()
  );

describe("mergeTripUpdateEntries", () => {
  it("keeps stops the feed dropped from the same run", () => {
    const merged = mergeTripUpdateEntries(
      [entry([stopUpdate("A", { arrivalDelaySeconds: 60 }), stopUpdate("B")])],
      [entry([stopUpdate("B", { arrivalDelaySeconds: 90 })])]
    );

    expect(merged[0].stopTimeUpdates.map((stop) => stop.stopId)).toEqual(["A", "B"]);
    expect(merged[0].stopTimeUpdates[0].arrivalDelaySeconds).toBe(60);
  });

  it("drops stops from a different service date", () => {
    const merged = mergeTripUpdateEntries(
      [entry([stopUpdate("A", { arrivalDelaySeconds: 60 })], "2026-09-21")],
      [entry([stopUpdate("B")], "2026-09-22")]
    );

    expect(merged[0].stopTimeUpdates.map((stop) => stop.stopId)).toEqual(["B"]);
  });

  it("replaces a stop in place when its platform changed", () => {
    const merged = mergeTripUpdateEntries(
      [entry([stopUpdate("P1", { stopSequence: 2, arrivalDelaySeconds: 60 })])],
      [entry([stopUpdate("P2", { stopSequence: 2, arrivalDelaySeconds: 90 })])]
    );

    expect(merged[0].stopTimeUpdates).toHaveLength(1);
    expect(merged[0].stopTimeUpdates[0].stopId).toBe("P2");
  });

  it("does not give a skipped stop the times it had before", () => {
    const merged = mergeTripUpdateEntries(
      [entry([stopUpdate("A", { arrivalDelaySeconds: 300, realtimeArrivalTimestamp: 1_790_000 })])],
      [entry([stopUpdate("A", { skipped: true })])]
    );

    expect(merged[0].stopTimeUpdates[0]).toMatchObject({
      skipped: true,
      arrivalDelaySeconds: null,
      realtimeArrivalTimestamp: null,
    });
  });
});

describe("toTripUpdates", () => {
  it("treats a delay the feed left out as unknown, and a zero delay as on time", () => {
    const feed = decodeFeed([
      {
        id: "1",
        tripUpdate: {
          trip: { tripId: "T", routeId: "APS_1a" },
          stopTimeUpdate: [
            { stopId: "A", arrival: { time: 1_790_000 } },
            { stopId: "B", arrival: { delay: 0 } },
          ],
        },
      },
    ]);

    const [update] = toTripUpdates(feed);
    expect(update.stopTimeUpdates[0].arrivalDelaySeconds).toBeNull();
    expect(update.stopTimeUpdates[1].arrivalDelaySeconds).toBe(0);
  });

  it("flags cancelled trips and skipped stops", () => {
    const feed = decodeFeed([
      {
        id: "1",
        tripUpdate: {
          trip: {
            tripId: "CANCELLED",
            scheduleRelationship: rt.TripDescriptor.ScheduleRelationship.CANCELED,
          },
        },
      },
      {
        id: "2",
        tripUpdate: {
          trip: { tripId: "T" },
          stopTimeUpdate: [
            {
              stopId: "A",
              scheduleRelationship: rt.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED,
            },
          ],
        },
      },
    ]);

    const [cancelled, running] = toTripUpdates(feed);
    expect(cancelled.cancelled).toBe(true);
    expect(running.cancelled).toBe(false);
    expect(running.stopTimeUpdates[0].skipped).toBe(true);
  });
});
