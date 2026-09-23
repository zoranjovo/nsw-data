import { trainKey } from "@/lib/trainIdentity";
import {
  buildTrainMotion,
  type InterpolatedTrainPosition,
  sampleTrainMotion,
  type TrainMotion,
} from "@/lib/trainPositionInterpolator";
import type { TimetableData } from "@/types/train/timetable";
import type { TrainTracksResponse } from "@/types/train/tracks";
import type { TrainPosition } from "@/types/train/train";

const EASE_DURATION_SECONDS = 1;
const MAX_EASE_SOURCE_AGE_SECONDS = 2;

type CacheEntry = {
  timetable: TimetableData;
  tracks: TrainTracksResponse;
  gpsStamp: string;
  motion: TrainMotion | null;
  lastSample: InterpolatedTrainPosition | null;
  lastSampleEpochSeconds: number;
  easeFrom: InterpolatedTrainPosition | null;
  easeStartEpochSeconds: number;
};

const gpsStamp = (position: TrainPosition): string =>
  `${position.timestamp ?? ""}|${position.latitude}|${position.longitude}`;

const easeTowards = (
  from: InterpolatedTrainPosition,
  to: InterpolatedTrainPosition,
  progress: number
): InterpolatedTrainPosition => ({
  ...to,
  latitude: from.latitude + (to.latitude - from.latitude) * progress,
  longitude: from.longitude + (to.longitude - from.longitude) * progress,
});

export type TrainMotionCache = {
  sample(
    position: TrainPosition,
    timetable: TimetableData | undefined,
    tracks: TrainTracksResponse,
    nowEpochSeconds: number
  ): InterpolatedTrainPosition | null;
  retainOnly(positions: TrainPosition[]): void;
};

export const createTrainMotionCache = (): TrainMotionCache => {
  const entries = new Map<string, CacheEntry>();

  return {
    sample(position, timetable, tracks, nowEpochSeconds) {
      if (!timetable) return null;

      const key = trainKey(position);
      const stamp = gpsStamp(position);
      let entry = entries.get(key);
      if (
        entry == null ||
        entry.timetable !== timetable ||
        entry.tracks !== tracks ||
        entry.gpsStamp !== stamp
      ) {
        const motion = buildTrainMotion(
          timetable,
          position,
          tracks,
          position.routeId || timetable.routeId
        );
        const recentSample =
          entry != null &&
          nowEpochSeconds - entry.lastSampleEpochSeconds <= MAX_EASE_SOURCE_AGE_SECONDS
            ? entry.lastSample
            : null;
        entry = {
          timetable,
          tracks,
          gpsStamp: stamp,
          motion,
          lastSample: recentSample,
          lastSampleEpochSeconds: entry?.lastSampleEpochSeconds ?? nowEpochSeconds,
          easeFrom: recentSample,
          easeStartEpochSeconds: nowEpochSeconds,
        };
        entries.set(key, entry);
      }

      const target = entry.motion != null ? sampleTrainMotion(entry.motion, nowEpochSeconds) : null;
      const progress = (nowEpochSeconds - entry.easeStartEpochSeconds) / EASE_DURATION_SECONDS;
      if (target == null || entry.easeFrom == null || progress >= 1) {
        entry.easeFrom = null;
        entry.lastSample = target;
        entry.lastSampleEpochSeconds = nowEpochSeconds;
        return target;
      }

      const eased = easeTowards(entry.easeFrom, target, Math.max(0, progress));
      entry.lastSample = eased;
      entry.lastSampleEpochSeconds = nowEpochSeconds;
      return eased;
    },

    retainOnly(positions) {
      const liveKeys = new Set(positions.map(trainKey));
      for (const key of entries.keys()) {
        if (!liveKeys.has(key)) {
          entries.delete(key);
        }
      }
    },
  };
};
