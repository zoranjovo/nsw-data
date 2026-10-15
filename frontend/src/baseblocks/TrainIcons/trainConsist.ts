import { METERS_PER_DEGREE } from "@/lib/geo";
import {
  type InterpolatedTrainPosition,
  sampleTrainMotionAt,
  type TrainMotion,
} from "@/lib/trainPositionInterpolator";

export type ConsistCar = {
  kind: "driving" | "intermediate";
  reversed: boolean;
};

export type CarExtents = {
  front: number;
  rear: number;
};

export type TrackPlacement = {
  motion: TrainMotion;
  distanceMeters: number;
};

const DEFAULT_CAR_COUNT: Record<string, number> = { A: 8, B: 8, T: 8 };
const FALLBACK_CAR_COUNT = 4;

// How each fleet's units couple into the trains seen on the network
const unitSizes = (fleetCode: string, carCount: number): number[] => {
  switch (fleetCode) {
    case "T":
    case "M":
    case "H":
      return carCount > 4 && carCount % 4 === 0 ? Array(carCount / 4).fill(4) : [carCount];
    case "D":
      if (carCount === 8) return [4, 4];
      if (carCount === 10) return [4, 6];
      return [carCount];
    default:
      return [carCount];
  }
};

export const consistLayout = (
  fleetCode: string | null | undefined,
  carCount: number | null | undefined
): ConsistCar[] => {
  const code = fleetCode?.trim().toUpperCase() ?? "";
  const cars = Math.max(1, Math.round(carCount ?? DEFAULT_CAR_COUNT[code] ?? FALLBACK_CAR_COUNT));
  return unitSizes(code, cars).flatMap((size): ConsistCar[] => {
    if (size === 1) return [{ kind: "driving", reversed: false }];
    return [
      { kind: "driving", reversed: false },
      ...Array.from(
        { length: size - 2 },
        (): ConsistCar => ({ kind: "intermediate", reversed: false })
      ),
      { kind: "driving", reversed: true },
    ];
  });
};

// Where each car's origin sits, in metres ahead of the middle of the train, with cars touching
export const carOffsets = (extents: readonly CarExtents[]): number[] => {
  const length = extents.reduce((total, car) => total + car.front + car.rear, 0);
  let cursor = length / 2;
  return extents.map(({ front, rear }) => {
    const origin = cursor - front;
    cursor = origin - rear;
    return origin;
  });
};

export const placeAlongTrain = (
  centre: { longitude: number; latitude: number; bearing: number | null },
  track: TrackPlacement | null,
  offsetMeters: number
): InterpolatedTrainPosition => {
  if (track) {
    return sampleTrainMotionAt(
      track.motion,
      track.distanceMeters + track.motion.direction * offsetMeters
    );
  }
  const bearing = centre.bearing ?? 0;
  const radians = (bearing * Math.PI) / 180;
  const latitude = centre.latitude + (Math.cos(radians) * offsetMeters) / METERS_PER_DEGREE;
  const longitude =
    centre.longitude +
    (Math.sin(radians) * offsetMeters) /
      (METERS_PER_DEGREE * Math.cos((centre.latitude * Math.PI) / 180));
  return { latitude, longitude, bearing };
};
