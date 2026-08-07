import type { TrainPosition } from "@/types/train/train";

// Stable per-vehicle key for caches
export const trainKey = (position: TrainPosition): string =>
  position.tripId.length > 0 ? `t:${position.tripId}` : `v:${position.vehicleId}`;

export const isSameTrain = (position: TrainPosition, other: TrainPosition | null): boolean =>
  other != null &&
  ((other.tripId.length > 0 && position.tripId === other.tripId) ||
    (other.vehicleId.length > 0 && position.vehicleId === other.vehicleId));
