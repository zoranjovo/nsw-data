import type { TimetableData, TimetableStop } from "@/types/train/timetable";

export type TrainDelayLevel = 0 | 1 | 2;

export const SLIGHTLY_LATE_SECONDS = 120;
export const LATE_SECONDS = 300;

const leavesAt = (stop: TimetableStop): number | null =>
  stop.realtimeDepartureTimestamp ??
  stop.realtimeArrivalTimestamp ??
  stop.scheduledDepartureTimestamp ??
  stop.scheduledArrivalTimestamp;

// Delay predicted at the next stop the train has not yet left
export const currentTrainDelaySeconds = (
  timetable: TimetableData,
  nowEpochSeconds: number
): number | null => {
  const stops = timetable.stops.filter((stop) => !stop.skipped);
  const next =
    stops.find((stop) => (leavesAt(stop) ?? Number.NEGATIVE_INFINITY) >= nowEpochSeconds) ??
    stops[stops.length - 1];
  if (!next) return null;
  return next.arrivalDelaySeconds ?? next.departureDelaySeconds;
};

export const trainDelayLevel = (delaySeconds: number | null): TrainDelayLevel => {
  if (delaySeconds == null || delaySeconds < SLIGHTLY_LATE_SECONDS) return 0;
  return delaySeconds < LATE_SECONDS ? 1 : 2;
};
