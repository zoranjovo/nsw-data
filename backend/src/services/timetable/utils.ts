import { DateTime } from "luxon";
import type {
  StaticRoute,
  StaticStop,
  StaticStopTime,
  StaticTrip,
  TimetableData,
  TimetableProgress,
  TimetableStop,
} from "../../types/train/timetable";
import type { TripUpdateEntry, TripUpdateStopTime } from "../../types/train/tripUpdates";
import { normalizeGtfsRealtimeEpoch } from "../tripUpdates/utils";

const SYDNEY_ZONE = "Australia/Sydney";

const isServiceDate = (value: string | null | undefined): value is string => {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
};

const getStopMomentSeconds = (stopTime: StaticStopTime): number | null => {
  return stopTime.departureSeconds ?? stopTime.arrivalSeconds ?? null;
};

export const toUnixTimestampForSydneyServiceDate = (
  serviceDate: string,
  secondsAfterMidnight: number | null
): number | null => {
  if (secondsAfterMidnight == null) {
    return null;
  }

  const dayOffset = Math.floor(secondsAfterMidnight / 86_400);
  const secondsWithinDay = secondsAfterMidnight - dayOffset * 86_400;
  const hours = Math.floor(secondsWithinDay / 3600);
  const minutes = Math.floor((secondsWithinDay % 3600) / 60);
  const seconds = secondsWithinDay % 60;

  const base = DateTime.fromFormat(serviceDate, "yyyy-MM-dd", { zone: SYDNEY_ZONE });
  if (!base.isValid) {
    return null;
  }
  const dt = base.plus({ days: dayOffset }).set({ hour: hours, minute: minutes, second: seconds });
  return Math.floor(dt.toSeconds());
};

const resolveServiceDateForTrip = (args: {
  providedServiceDate: string | null | undefined;
  stopTimes: StaticStopTime[];
  now?: DateTime;
}): string => {
  const now = (args.now ?? DateTime.now()).setZone(SYDNEY_ZONE);
  const today = now.toFormat("yyyy-MM-dd");
  const todayDate = DateTime.fromFormat(today, "yyyy-MM-dd", { zone: SYDNEY_ZONE });
  const yesterday = todayDate.minus({ days: 1 }).toFormat("yyyy-MM-dd");
  const tomorrow = todayDate.plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const candidateDates = [args.providedServiceDate, today, yesterday, tomorrow].filter(
    (value, index, source): value is string => {
      return isServiceDate(value) && source.indexOf(value) === index;
    }
  );
  if (candidateDates.length === 0) {
    return today;
  }

  const nowEpochSeconds = Math.floor(now.toSeconds());
  const activeWindowPaddingSeconds = 30 * 60;
  let bestDate = candidateDates[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidateDate of candidateDates) {
    const moments = args.stopTimes
      .map((stopTime) =>
        toUnixTimestampForSydneyServiceDate(candidateDate, getStopMomentSeconds(stopTime))
      )
      .filter((moment): moment is number => moment != null);
    if (moments.length === 0) {
      continue;
    }
    const minMoment = Math.min(...moments);
    const maxMoment = Math.max(...moments);
    const windowStart = minMoment - activeWindowPaddingSeconds;
    const windowEnd = maxMoment + activeWindowPaddingSeconds;
    const distanceToWindow =
      nowEpochSeconds < windowStart
        ? windowStart - nowEpochSeconds
        : nowEpochSeconds > windowEnd
          ? nowEpochSeconds - windowEnd
          : 0;
    if (distanceToWindow < bestScore) {
      bestScore = distanceToWindow;
      bestDate = candidateDate;
    }
  }

  return bestDate;
};

export const mergeStopTimeUpdates = (
  stopTimes: StaticStopTime[],
  stopUpdates: TripUpdateStopTime[],
  serviceDate: string,
  stopsById: Map<string, StaticStop>
): TimetableStop[] => {
  let updateIndex = 0;

  return stopTimes.map((stopTime) => {
    let matchedUpdate: TripUpdateStopTime | null = null;

    for (let index = updateIndex; index < stopUpdates.length; index += 1) {
      const candidate = stopUpdates[index];
      if (candidate.stopId !== stopTime.stopId) {
        continue;
      }
      matchedUpdate = candidate;
      updateIndex = index + 1;
      break;
    }

    const stop = stopsById.get(stopTime.stopId);
    const scheduledArrivalTimestamp = toUnixTimestampForSydneyServiceDate(
      serviceDate,
      stopTime.arrivalSeconds
    );
    const scheduledDepartureTimestamp = toUnixTimestampForSydneyServiceDate(
      serviceDate,
      stopTime.departureSeconds
    );
    const rawRealtimeArrival = normalizeGtfsRealtimeEpoch(matchedUpdate?.realtimeArrivalTimestamp);
    const rawRealtimeDeparture = normalizeGtfsRealtimeEpoch(
      matchedUpdate?.realtimeDepartureTimestamp
    );
    const realtimeArrivalTimestamp =
      rawRealtimeArrival ??
      (scheduledArrivalTimestamp == null || matchedUpdate?.arrivalDelaySeconds == null
        ? null
        : scheduledArrivalTimestamp + matchedUpdate.arrivalDelaySeconds);
    const realtimeDepartureTimestamp =
      rawRealtimeDeparture ??
      (scheduledDepartureTimestamp == null || matchedUpdate?.departureDelaySeconds == null
        ? null
        : scheduledDepartureTimestamp + matchedUpdate.departureDelaySeconds);

    return {
      stopId: stopTime.stopId,
      stopName: stop?.stopName ?? null,
      stopSequence: stopTime.stopSequence,
      hasRealtimeStopUpdate: matchedUpdate != null,
      latitude: stop?.latitude ?? null,
      longitude: stop?.longitude ?? null,
      scheduledArrival: stopTime.arrivalTime,
      scheduledDeparture: stopTime.departureTime,
      scheduledArrivalSeconds: stopTime.arrivalSeconds,
      scheduledDepartureSeconds: stopTime.departureSeconds,
      scheduledArrivalTimestamp,
      scheduledDepartureTimestamp,
      realtimeArrivalTimestamp,
      realtimeDepartureTimestamp,
      arrivalDelaySeconds: matchedUpdate?.arrivalDelaySeconds ?? null,
      departureDelaySeconds: matchedUpdate?.departureDelaySeconds ?? null,
    };
  });
};

const effectiveStopTimeEpoch = (
  realtimeTimestamp: number | null | undefined,
  scheduledTimestamp: number | null | undefined,
  delaySeconds: number | null | undefined
): number | null => {
  const coalesced = normalizeGtfsRealtimeEpoch(realtimeTimestamp);
  if (coalesced != null) {
    return coalesced;
  }
  if (scheduledTimestamp != null && delaySeconds != null && delaySeconds !== 0) {
    return scheduledTimestamp + delaySeconds;
  }
  return scheduledTimestamp ?? null;
};

const getStopOrderingMoment = (stop: TimetableStop): number | null => {
  return (
    effectiveStopTimeEpoch(
      stop.realtimeDepartureTimestamp,
      stop.scheduledDepartureTimestamp,
      stop.departureDelaySeconds
    ) ??
    effectiveStopTimeEpoch(
      stop.realtimeArrivalTimestamp,
      stop.scheduledArrivalTimestamp,
      stop.arrivalDelaySeconds
    )
  );
};

export const buildProgress = (stops: TimetableStop[]): TimetableProgress | null => {
  if (stops.length === 0) {
    return null;
  }

  const now = Math.floor(DateTime.now().toMillis() / 1000);
  const nextStop = stops.find((stop) => {
    const moment = getStopOrderingMoment(stop);
    return moment != null && moment >= now;
  });

  if (!nextStop) {
    const currentStop = stops.at(-1) ?? null;
    if (!currentStop) {
      return null;
    }
    return {
      currentStopId: currentStop.stopId,
      currentStopName: currentStop.stopName,
      currentStopSequence: currentStop.stopSequence,
      nextStopId: null,
      nextStopName: null,
      nextStopSequence: null,
    };
  }

  const nextIndex = stops.findIndex((stop) => stop.stopSequence === nextStop.stopSequence);
  const currentStop = nextIndex > 0 ? stops[nextIndex - 1] : null;

  return {
    currentStopId: currentStop?.stopId ?? null,
    currentStopName: currentStop?.stopName ?? null,
    currentStopSequence: currentStop?.stopSequence ?? null,
    nextStopId: nextStop.stopId,
    nextStopName: nextStop.stopName,
    nextStopSequence: nextStop.stopSequence,
  };
};

export const buildTrainTimetable = (args: {
  tripId: string;
  tripsById: Map<string, StaticTrip>;
  stopTimesByTripId: Map<string, StaticStopTime[]>;
  routesById: Map<string, StaticRoute>;
  stopsById: Map<string, StaticStop>;
  tripUpdate: TripUpdateEntry | null;
  tripUpdatesFetchedAt: number;
  staticTimetableFetchedAt: number;
}): TimetableData | null => {
  const trip = args.tripsById.get(args.tripId);
  const stopTimes = args.stopTimesByTripId.get(args.tripId);
  if (!trip || !stopTimes || stopTimes.length === 0) {
    return null;
  }

  const route = args.routesById.get(trip.routeId);
  const serviceDate = resolveServiceDateForTrip({
    providedServiceDate: isServiceDate(args.tripUpdate?.serviceDate)
      ? args.tripUpdate.serviceDate
      : null,
    stopTimes,
  });
  const stops = mergeStopTimeUpdates(
    stopTimes,
    args.tripUpdate?.stopTimeUpdates ?? [],
    serviceDate,
    args.stopsById
  );

  return {
    tripId: args.tripId,
    routeId: trip.routeId,
    routeShortName: route?.routeShortName ?? null,
    routeLongName: route?.routeLongName ?? null,
    tripHeadsign: trip.tripHeadsign,
    vehicleId: args.tripUpdate?.vehicleId ?? null,
    tripUpdatesFetchedAt: args.tripUpdatesFetchedAt || null,
    staticTimetableFetchedAt: args.staticTimetableFetchedAt || null,
    progress: buildProgress(stops),
    stops,
  };
};
