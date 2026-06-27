import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DateTime } from "luxon";
import Parser from "stream-json/Parser";
import StreamArray from "stream-json/streamers/StreamArray";
import type {
  StaticRoute,
  StaticStop,
  StaticStopTime,
  StaticTimetableSnapshot,
  StaticTrip,
  TimetableData,
} from "../../types/train/timetable";
import { debugLog } from "../../utils/debug";
import { getStaticAssetsDir } from "../staticData/staticData";
import { getTripUpdates } from "../tripUpdates/store";
import {
  getStaticTimetable,
  getStaticTimetableFetchPromise,
  setStaticTimetable,
  setStaticTimetableFetchPromise,
} from "./store";
import { buildTrainTimetable } from "./utils";

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const next = value.trim();
  return next.length > 0 ? next : null;
};

const normalizeInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const next = Number.parseInt(value, 10);
    return Number.isFinite(next) ? next : null;
  }
  return null;
};

const normalizeNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const next = Number.parseFloat(value);
    return Number.isFinite(next) ? next : null;
  }
  return null;
};

const streamAssetArray = async <T>(
  assetsDir: string,
  filename: string,
  onRecord: (record: Partial<T>) => void
): Promise<number> => {
  let count = 0;
  const stream = new Transform({
    objectMode: true,
    transform(chunk, _encoding, callback) {
      const value = (chunk as { value?: Partial<T> }).value;
      if (value) {
        count += 1;
        onRecord(value);
      }
      callback();
    },
  });

  await pipeline(
    createReadStream(resolve(assetsDir, filename), { encoding: "utf8" }),
    Parser.parser(),
    StreamArray.streamArray(),
    stream
  );

  return count;
};

const buildSnapshotFromAssets = async (assetsDir: string): Promise<StaticTimetableSnapshot> => {
  const stopsById = new Map<string, StaticStop>();
  const routesById = new Map<string, StaticRoute>();
  const tripsById = new Map<string, StaticTrip>();
  const stopTimesByTripId = new Map<string, StaticStopTime[]>();
  const tripIdsByRouteId = new Map<string, string[]>();
  const tripIdsByStopId = new Map<string, string[]>();

  const routesCount = await streamAssetArray<StaticRoute>(assetsDir, "routes.json", (rawRoute) => {
    const routeId = normalizeString(rawRoute.routeId);
    if (!routeId) {
      return;
    }

    routesById.set(routeId, {
      routeId,
      routeShortName: normalizeString(rawRoute.routeShortName),
      routeLongName: normalizeString(rawRoute.routeLongName),
    });
  });

  const tripsCount = await streamAssetArray<StaticTrip>(assetsDir, "trips.json", (rawTrip) => {
    const tripId = normalizeString(rawTrip.tripId);
    const routeId = normalizeString(rawTrip.routeId);
    if (!tripId || !routeId) {
      return;
    }

    tripsById.set(tripId, {
      tripId,
      routeId,
      serviceId: normalizeString(rawTrip.serviceId),
      tripHeadsign: normalizeString(rawTrip.tripHeadsign),
    });

    const tripIdsForRoute = tripIdsByRouteId.get(routeId);
    if (tripIdsForRoute) {
      tripIdsForRoute.push(tripId);
    } else {
      tripIdsByRouteId.set(routeId, [tripId]);
    }
  });

  const stopTimesCount = await streamAssetArray<StaticStopTime>(
    assetsDir,
    "stopTimes.json",
    (rawStopTime) => {
      const tripId = normalizeString(rawStopTime.tripId);
      const stopId = normalizeString(rawStopTime.stopId);
      const stopSequence = normalizeInt(rawStopTime.stopSequence);
      if (!tripId || !stopId || stopSequence == null) {
        return;
      }

      const stopTime: StaticStopTime = {
        tripId,
        stopId,
        arrivalTime: normalizeString(rawStopTime.arrivalTime),
        departureTime: normalizeString(rawStopTime.departureTime),
        arrivalSeconds: normalizeInt(rawStopTime.arrivalSeconds),
        departureSeconds: normalizeInt(rawStopTime.departureSeconds),
        stopSequence,
      };

      const stopTimesForTrip = stopTimesByTripId.get(tripId);
      if (stopTimesForTrip) {
        stopTimesForTrip.push(stopTime);
      } else {
        stopTimesByTripId.set(tripId, [stopTime]);
      }

      const tripIdsForStop = tripIdsByStopId.get(stopId);
      if (tripIdsForStop) {
        tripIdsForStop.push(tripId);
      } else {
        tripIdsByStopId.set(stopId, [tripId]);
      }
    }
  );

  const stopsCount = await streamAssetArray<StaticStop>(assetsDir, "stops.json", (rawStop) => {
    const stopId = normalizeString(rawStop.stopId);
    if (!stopId) {
      return;
    }

    stopsById.set(stopId, {
      stopId,
      stopName: normalizeString(rawStop.stopName),
      latitude: normalizeNumber(rawStop.latitude),
      longitude: normalizeNumber(rawStop.longitude),
    });
  });

  debugLog(
    "LOADED",
    `streamed assets routes=${routesCount} trips=${tripsCount} stopTimes=${stopTimesCount} stops=${stopsCount}`
  );

  for (const stopTimes of stopTimesByTripId.values()) {
    stopTimes.sort((a, b) => a.stopSequence - b.stopSequence);
  }

  const fetchedAt = DateTime.now().toMillis();
  return {
    stopsById,
    routesById,
    tripsById,
    stopTimesByTripId,
    tripIdsByRouteId,
    tripIdsByStopId,
    fetchedAt,
  };
};

export const loadStaticTimetableFromAssets = async (force = false): Promise<void> => {
  const snapshot = getStaticTimetable();
  if (!force && snapshot.tripsById.size > 0 && snapshot.stopsById.size > 0) {
    return;
  }
  const inflight = getStaticTimetableFetchPromise();
  if (inflight) {
    await inflight;
    if (!force) {
      const after = getStaticTimetable();
      if (after.tripsById.size > 0 && after.stopsById.size > 0) {
        return;
      }
    }
  }

  const nextFetchPromise = (async () => {
    const nextSnapshot = await buildSnapshotFromAssets(getStaticAssetsDir());
    setStaticTimetable(nextSnapshot);
    debugLog(
      "LOADED",
      `loaded local assets stops=${nextSnapshot.stopsById.size} routes=${nextSnapshot.routesById.size} trips=${nextSnapshot.tripsById.size} stopTimes=${nextSnapshot.stopTimesByTripId.size}`
    );
  })();

  setStaticTimetableFetchPromise(nextFetchPromise);

  try {
    await nextFetchPromise;
  } finally {
    if (getStaticTimetableFetchPromise() === nextFetchPromise) {
      setStaticTimetableFetchPromise(null);
    }
  }
};

export const getTripTimetableByTripId = (tripId: string): TimetableData | null => {
  const snapshot = getStaticTimetable();
  const tripUpdates = getTripUpdates();
  const tripUpdate = tripUpdates.items.find((item) => item.tripId === tripId) ?? null;

  return buildTrainTimetable({
    tripId,
    tripsById: snapshot.tripsById,
    stopTimesByTripId: snapshot.stopTimesByTripId,
    routesById: snapshot.routesById,
    stopsById: snapshot.stopsById,
    tripUpdate,
    tripUpdatesFetchedAt: tripUpdates.fetchedAt,
    staticTimetableFetchedAt: snapshot.fetchedAt,
  });
};
