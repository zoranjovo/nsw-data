import type { TrainDestination } from "@/lib/trainDestination";
import type { TrainPosition } from "@/types/train/train";

export type TrainMarker = {
  key: string;
  position: TrainPosition;
  fleetCode: string | null;
  destination: TrainDestination;
  isSelected: boolean;
  longitude: number;
  latitude: number;
  bearing: number | null;
  isStale: boolean;
  isNearView: boolean;
};

export type GetTrainMarkers = () => readonly TrainMarker[];

// [zoom, icon scale] stops, interpolated linearly like a MapLibre zoom expression
const ICON_SCALE_STOPS: [number, number][] = [
  [8, 0.3],
  [11, 0.6],
  [14, 0.95],
  [17, 1.4],
];

export const TRAIN_ICON_BASE_SIZE_PX = 48;

export const trainIconSizePx = (zoom: number): number => {
  const first = ICON_SCALE_STOPS[0];
  const last = ICON_SCALE_STOPS[ICON_SCALE_STOPS.length - 1];
  if (zoom <= first[0]) return first[1] * TRAIN_ICON_BASE_SIZE_PX;
  if (zoom >= last[0]) return last[1] * TRAIN_ICON_BASE_SIZE_PX;
  for (let i = 1; i < ICON_SCALE_STOPS.length; i++) {
    const [zoomB, scaleB] = ICON_SCALE_STOPS[i];
    if (zoom > zoomB) continue;
    const [zoomA, scaleA] = ICON_SCALE_STOPS[i - 1];
    return (
      (scaleA + ((zoom - zoomA) / (zoomB - zoomA)) * (scaleB - scaleA)) * TRAIN_ICON_BASE_SIZE_PX
    );
  }
  return last[1] * TRAIN_ICON_BASE_SIZE_PX;
};

export const pickTrainMarker = (
  markers: readonly TrainMarker[],
  point: { x: number; y: number },
  radiusPx: number,
  project: (longitude: number, latitude: number) => { x: number; y: number }
): TrainMarker | null => {
  let best: TrainMarker | null = null;
  let bestDistance = radiusPx * radiusPx;
  for (const marker of markers) {
    if (!marker.isNearView) continue;
    const screen = project(marker.longitude, marker.latitude);
    const dx = screen.x - point.x;
    const dy = screen.y - point.y;
    const distance = dx * dx + dy * dy;
    if (distance <= bestDistance) {
      best = marker;
      bestDistance = distance;
    }
  }
  return best;
};
