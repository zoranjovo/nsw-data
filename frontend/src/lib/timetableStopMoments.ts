import type { TimetableStop } from "@/types/train/timetable";

const coalesceEpochSeconds = (value: number | null | undefined): number | null => {
  if (value == null || value === 0) {
    return null;
  }
  return value;
};

export const effectiveStopTimeEpoch = (
  realtimeTimestamp: number | null | undefined,
  scheduledTimestamp: number | null | undefined,
  delaySeconds: number | null | undefined
): number | null => {
  const coalesced = coalesceEpochSeconds(realtimeTimestamp);
  if (coalesced != null) {
    return coalesced;
  }
  if (scheduledTimestamp != null && delaySeconds != null && delaySeconds !== 0) {
    return scheduledTimestamp + delaySeconds;
  }
  return scheduledTimestamp ?? null;
};

export const getStopOrderingMoment = (stop: TimetableStop): number | null => {
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

const approxDistanceMeters = (
  vehicleLat: number | null | undefined,
  vehicleLon: number | null | undefined,
  stopLat: number | null | undefined,
  stopLon: number | null | undefined
): number | null => {
  if (
    vehicleLat == null ||
    vehicleLon == null ||
    stopLat == null ||
    stopLon == null ||
    !Number.isFinite(vehicleLat) ||
    !Number.isFinite(vehicleLon) ||
    !Number.isFinite(stopLat) ||
    !Number.isFinite(stopLon)
  ) {
    return null;
  }
  const dy = (stopLat - vehicleLat) * 111_000;
  const cosLat = Math.cos((vehicleLat * Math.PI) / 180);
  const dx = (stopLon - vehicleLon) * 111_000 * cosLat;
  return Math.hypot(dx, dy);
};

const NEAR_CURRENT_STOP_M = 320;

export const resolveNextStopForBearing = (
  stops: TimetableStop[],
  nowEpochSeconds: number,
  currentStopSequence: number | null | undefined,
  vehicleLat?: number | null,
  vehicleLon?: number | null
): TimetableStop | null => {
  if (stops.length === 0) {
    return null;
  }

  const nextByTime = stops.find((stop) => {
    const moment = getStopOrderingMoment(stop);
    return moment != null && moment >= nowEpochSeconds;
  });

  const seq = currentStopSequence != null && currentStopSequence > 0 ? currentStopSequence : 0;
  const atSeq = seq > 0 ? stops.find((s) => s.stopSequence === seq) : undefined;
  const nextAfterSeq = seq > 0 ? stops.find((s) => s.stopSequence > seq) : undefined;

  // Case 1: no sequence from feed
  if (seq <= 0) {
    return nextByTime ?? null;
  }

  // Case 2: no future stop by time
  if (nextByTime == null) {
    return nextAfterSeq ?? null;
  }

  const tSeq = nextByTime.stopSequence;

  // Case 3: vehicle report is ahead of the time-based “next” stop
  if (seq > tSeq) {
    return atSeq ?? nextAfterSeq ?? nextByTime;
  }

  // Case 4: timetable next is further along than the reported sequence
  if (tSeq > seq) {
    return nextByTime;
  }

  // Cases 5–6: time and sequence agree on the same stop
  const d = approxDistanceMeters(vehicleLat, vehicleLon, nextByTime.latitude, nextByTime.longitude);
  if (d != null && d < NEAR_CURRENT_STOP_M && nextAfterSeq != null) {
    return nextAfterSeq;
  }
  return nextByTime;
};
