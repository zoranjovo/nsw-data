import type { Map as MaplibreMap } from "maplibre-gl";
import { metersPerPixel } from "../MapView/mapViewport";

const MIN_UPDATE_INTERVAL_MS = 1000 / 30;
const MAX_UPDATE_INTERVAL_MS = 1000;
const STEPPED_UPDATE_INTERVAL_MS = 1000;
const TARGET_PIXEL_STEP = 0.5;
const ASSUMED_TRAIN_SPEED_MPS = 30;

export const trainUpdateIntervalMs = (map: MaplibreMap, smooth: boolean): number => {
  if (!smooth) return STEPPED_UPDATE_INTERVAL_MS;
  const intervalMs = (TARGET_PIXEL_STEP * metersPerPixel(map) * 1000) / ASSUMED_TRAIN_SPEED_MPS;
  return Math.min(MAX_UPDATE_INTERVAL_MS, Math.max(MIN_UPDATE_INTERVAL_MS, intervalMs));
};
