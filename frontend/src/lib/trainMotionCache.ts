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

type CacheEntry = {
  timetable: TimetableData;
  tracks: TrainTracksResponse;
  motion: TrainMotion | null;
};

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
      let entry = entries.get(key);
      if (entry == null || entry.timetable !== timetable || entry.tracks !== tracks) {
        entry = {
          timetable,
          tracks,
          motion: buildTrainMotion(timetable, tracks, position.routeId || timetable.routeId),
        };
        entries.set(key, entry);
      }
      return entry.motion != null ? sampleTrainMotion(entry.motion, nowEpochSeconds) : null;
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
