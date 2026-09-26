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

const serviceDayStartByDate = new Map<string, number | null>();

const getServiceDayStart = (serviceDate: string): number | null => {
  let dayStart = serviceDayStartByDate.get(serviceDate);
  if (dayStart === undefined) {
    const noon = DateTime.fromFormat(serviceDate, "yyyy-MM-dd", { zone: SYDNEY_ZONE }).set({
      hour: 12,
    });
    dayStart = noon.isValid ? Math.floor(noon.toSeconds()) - 12 * 3600 : null;
    serviceDayStartByDate.set(serviceDate, dayStart);
  }
  return dayStart;
};

export const toUnixTimestampForSydneyServiceDate = (
  serviceDate: string,
  secondsAfterMidnight: number | null
): number | null => {
  if (secondsAfterMidnight == null) {
    return null;
  }
  const dayStart = getServiceDayStart(serviceDate);
  return dayStart == null ? null : dayStart + secondsAfterMidnight;
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

const formatGtfsTime = (seconds: number | null): string | null => {
  if (seconds == null) {
    return null;
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
};

const delayBetween = (realtime: number | null, scheduled: number | null): number | null => {
  return realtime == null || scheduled == null ? null : realtime - scheduled;
};

const addDelay = (scheduled: number | null, delaySeconds: number | null): number | null => {
  return scheduled == null || delaySeconds == null ? null : scheduled + delaySeconds;
};

export const mergeStopTimeUpdates = (
  stopTimes: StaticStopTime[],
  stopUpdates: TripUpdateStopTime[],
  serviceDate: string,
  stopsById: Map<string, StaticStop>
): TimetableStop[] => {
  const updateIndexBySequence = new Map<number, number>();
  for (const [index, update] of stopUpdates.entries()) {
    if (update.stopSequence != null) {
      updateIndexBySequence.set(update.stopSequence, index);
    }
  }
  let updateIndex = 0;
  let propagatedDelaySeconds: number | null = null;

  return stopTimes.map((stopTime) => {
    let matchedIndex = updateIndexBySequence.get(stopTime.stopSequence) ?? -1;

    for (let index = updateIndex; matchedIndex === -1 && index < stopUpdates.length; index += 1) {
      const candidate = stopUpdates[index];
      if (
        candidate.stopId === stopTime.stopId &&
        (candidate.stopSequence == null || candidate.stopSequence === stopTime.stopSequence)
      ) {
        matchedIndex = index;
      }
    }
    if (matchedIndex !== -1) {
      updateIndex = matchedIndex + 1;
    }
    const matchedUpdate: TripUpdateStopTime | null =
      matchedIndex === -1 ? null : stopUpdates[matchedIndex];
    const timingUpdate = matchedUpdate?.skipped || matchedUpdate?.noData ? null : matchedUpdate;
    if (matchedUpdate?.noData) {
      propagatedDelaySeconds = null;
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
    const rawRealtimeArrival = normalizeGtfsRealtimeEpoch(timingUpdate?.realtimeArrivalTimestamp);
    const rawRealtimeDeparture = normalizeGtfsRealtimeEpoch(
      timingUpdate?.realtimeDepartureTimestamp
    );
    const arrivalDelaySeconds =
      timingUpdate?.arrivalDelaySeconds ??
      delayBetween(rawRealtimeArrival, scheduledArrivalTimestamp) ??
      propagatedDelaySeconds;
    const departureDelaySeconds =
      timingUpdate?.departureDelaySeconds ??
      delayBetween(rawRealtimeDeparture, scheduledDepartureTimestamp) ??
      arrivalDelaySeconds;
    propagatedDelaySeconds = departureDelaySeconds;
    const realtimeArrivalTimestamp =
      rawRealtimeArrival ?? addDelay(scheduledArrivalTimestamp, arrivalDelaySeconds);
    const realtimeDepartureTimestamp =
      rawRealtimeDeparture ?? addDelay(scheduledDepartureTimestamp, departureDelaySeconds);

    return {
      stopId: stopTime.stopId,
      stopName: stop?.stopName ?? null,
      stopSequence: stopTime.stopSequence,
      hasRealtimeStopUpdate: matchedUpdate != null,
      skipped: matchedUpdate?.skipped ?? false,
      latitude: stop?.latitude ?? null,
      longitude: stop?.longitude ?? null,
      scheduledArrival: formatGtfsTime(stopTime.arrivalSeconds),
      scheduledDeparture: formatGtfsTime(stopTime.departureSeconds),
      scheduledArrivalSeconds: stopTime.arrivalSeconds,
      scheduledDepartureSeconds: stopTime.departureSeconds,
      scheduledArrivalTimestamp,
      scheduledDepartureTimestamp,
      realtimeArrivalTimestamp,
      realtimeDepartureTimestamp,
      arrivalDelaySeconds,
      departureDelaySeconds,
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

export const buildProgress = (timetableStops: TimetableStop[]): TimetableProgress | null => {
  const stops = timetableStops.filter((stop) => !stop.skipped);
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
    cancelled: args.tripUpdate?.cancelled ?? false,
    tripUpdatesFetchedAt: args.tripUpdatesFetchedAt || null,
    staticTimetableFetchedAt: args.staticTimetableFetchedAt || null,
    progress: buildProgress(stops),
    stops,
  };
};
