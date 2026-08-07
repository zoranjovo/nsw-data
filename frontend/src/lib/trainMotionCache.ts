import { trainKey } from "@/lib/trainIdentity";
import { buildTrainMotion, type TrainMotion } from "@/lib/trainPositionInterpolator";
import type { TimetableData } from "@/types/train/timetable";
import type { TrainTracksResponse } from "@/types/train/tracks";
import type { TrainPosition } from "@/types/train/train";

type CacheEntry = {
  timetable: TimetableData;
  tracks: TrainTracksResponse;
  gpsStamp: string;
  motion: TrainMotion | null;
};

const gpsStamp = (position: TrainPosition): string =>
  `${position.timestamp ?? ""}|${position.latitude}|${position.longitude}`;

export type TrainMotionCache = {
  get(
    position: TrainPosition,
    timetable: TimetableData | undefined,
    tracks: TrainTracksResponse
  ): TrainMotion | null;
  retainOnly(positions: TrainPosition[]): void;
};

export const createTrainMotionCache = (): TrainMotionCache => {
  const entries = new Map<string, CacheEntry>();

  return {
    get(position, timetable, tracks) {
      if (!timetable) return null;

      const key = trainKey(position);
      const stamp = gpsStamp(position);
      const cached = entries.get(key);
      if (
        cached != null &&
        cached.timetable === timetable &&
        cached.tracks === tracks &&
        cached.gpsStamp === stamp
      ) {
        return cached.motion;
      }

      const motion = buildTrainMotion(
        timetable,
        position,
        tracks,
        position.routeId || timetable.routeId
      );
      entries.set(key, { timetable, tracks, gpsStamp: stamp, motion });
      return motion;
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
