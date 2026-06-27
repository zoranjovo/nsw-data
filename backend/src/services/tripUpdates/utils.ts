import type GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { TripUpdateEntry, TripUpdateStopTime } from "../../types/train/tripUpdates";
import { isExcludedTrainRouteId } from "../excludedTrainRoutes";

type DecodedFeed = ReturnType<typeof GtfsRealtimeBindings.transit_realtime.FeedMessage.decode>;
type FeedEntity = DecodedFeed["entity"][number];

export const normalizeGtfsRealtimeEpoch = (value: number | null | undefined): number | null => {
  if (value == null || value === 0) {
    return null;
  }
  return value;
};

const normalizeServiceDate = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d{8}$/.test(trimmed)) {
    return null;
  }
  return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
};

const mergeStopTimeUpdate = (
  previous: TripUpdateStopTime | null,
  incoming: TripUpdateStopTime
): TripUpdateStopTime => {
  return {
    stopId: incoming.stopId,
    arrivalDelaySeconds: incoming.arrivalDelaySeconds ?? previous?.arrivalDelaySeconds ?? null,
    departureDelaySeconds:
      incoming.departureDelaySeconds ?? previous?.departureDelaySeconds ?? null,
    realtimeArrivalTimestamp:
      normalizeGtfsRealtimeEpoch(incoming.realtimeArrivalTimestamp) ??
      normalizeGtfsRealtimeEpoch(previous?.realtimeArrivalTimestamp) ??
      null,
    realtimeDepartureTimestamp:
      normalizeGtfsRealtimeEpoch(incoming.realtimeDepartureTimestamp) ??
      normalizeGtfsRealtimeEpoch(previous?.realtimeDepartureTimestamp) ??
      null,
  };
};

const mergeStopTimeUpdates = (
  previous: TripUpdateStopTime[],
  incoming: TripUpdateStopTime[]
): TripUpdateStopTime[] => {
  if (previous.length === 0) {
    return incoming;
  }
  if (incoming.length === 0) {
    return previous;
  }

  const usedPrevious = Array.from({ length: previous.length }, () => false);
  const replacements = new Map<number, TripUpdateStopTime>();
  const incomingOnly: TripUpdateStopTime[] = [];
  let previousCursor = 0;

  for (const nextStop of incoming) {
    let matchedIndex = -1;

    for (let index = previousCursor; index < previous.length; index += 1) {
      if (usedPrevious[index]) {
        continue;
      }
      if (previous[index].stopId !== nextStop.stopId) {
        continue;
      }
      matchedIndex = index;
      break;
    }

    if (matchedIndex === -1) {
      for (let index = 0; index < previousCursor; index += 1) {
        if (usedPrevious[index]) {
          continue;
        }
        if (previous[index].stopId !== nextStop.stopId) {
          continue;
        }
        matchedIndex = index;
        break;
      }
    }

    if (matchedIndex === -1) {
      incomingOnly.push(mergeStopTimeUpdate(null, nextStop));
      continue;
    }

    usedPrevious[matchedIndex] = true;
    previousCursor = matchedIndex + 1;
    replacements.set(matchedIndex, mergeStopTimeUpdate(previous[matchedIndex], nextStop));
  }

  const merged: TripUpdateStopTime[] = [];
  for (let index = 0; index < previous.length; index += 1) {
    const replacement = replacements.get(index);
    merged.push(replacement ?? previous[index]);
  }

  merged.push(...incomingOnly);
  return merged;
};

export const mergeTripUpdateEntries = (
  previousEntries: TripUpdateEntry[],
  incomingEntries: TripUpdateEntry[]
): TripUpdateEntry[] => {
  const previousByTripId = new Map(previousEntries.map((entry) => [entry.tripId, entry]));
  const merged: TripUpdateEntry[] = [];

  for (const incomingEntry of incomingEntries) {
    const previousEntry = previousByTripId.get(incomingEntry.tripId);
    if (!previousEntry) {
      merged.push(incomingEntry);
      continue;
    }

    merged.push({
      tripId: incomingEntry.tripId,
      routeId: incomingEntry.routeId || previousEntry.routeId,
      vehicleId: incomingEntry.vehicleId ?? previousEntry.vehicleId ?? null,
      serviceDate: incomingEntry.serviceDate ?? previousEntry.serviceDate ?? null,
      stopTimeUpdates: mergeStopTimeUpdates(
        previousEntry.stopTimeUpdates,
        incomingEntry.stopTimeUpdates
      ),
    });
  }

  return merged;
};

export const toStopTimeUpdate = (entity: FeedEntity): TripUpdateEntry | null => {
  const tripUpdate = entity.tripUpdate;
  if (!tripUpdate?.trip?.tripId) {
    return null;
  }

  const stopTimeUpdates: TripUpdateStopTime[] = (tripUpdate.stopTimeUpdate ?? []).map((update) => ({
    stopId: update.stopId ?? "",
    arrivalDelaySeconds: update.arrival?.delay ?? null,
    departureDelaySeconds: update.departure?.delay ?? null,
    realtimeArrivalTimestamp:
      update.arrival?.time == null ? null : normalizeGtfsRealtimeEpoch(Number(update.arrival.time)),
    realtimeDepartureTimestamp:
      update.departure?.time == null
        ? null
        : normalizeGtfsRealtimeEpoch(Number(update.departure.time)),
  }));

  return {
    tripId: tripUpdate.trip.tripId,
    routeId: tripUpdate.trip.routeId ?? "",
    vehicleId: tripUpdate.vehicle?.id ?? null,
    serviceDate: normalizeServiceDate(tripUpdate.trip.startDate),
    stopTimeUpdates,
  };
};

export const toTripUpdates = (feed: DecodedFeed): TripUpdateEntry[] => {
  const nextTripUpdates = [];

  for (const entity of feed.entity ?? []) {
    const tripUpdate = toStopTimeUpdate(entity);
    if (!tripUpdate || isExcludedTrainRouteId(tripUpdate.routeId)) {
      continue;
    }
    nextTripUpdates.push(tripUpdate);
  }
  return nextTripUpdates;
};
