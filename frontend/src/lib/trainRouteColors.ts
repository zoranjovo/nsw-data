import type { TrainTrackFeature } from "@/types/train/tracks";
import { createRouteShortNameLookup } from "./trainRouteId";

export const ROUTE_COLOR_FALLBACK_BY_SHORT_NAME: Record<string, string> = {
  T1: "#F99D1C",
  T2: "#00A651",
  T3: "#8B4513",
  T4: "#F26522",
  T5: "#E4002B",
  T6: "#00A3E0",
  T7: "#00B5AD",
  T8: "#E4007C",
  T9: "#6C3F97",
};

export const ROUTE_COLOR_FALLBACK_DEFAULT = "#999999";

export const normaliseRouteHexColor = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
};

export const resolveTrainLineColor = (routeShortName: string, routeColorGtfs: string): string => {
  const fromGtfs = normaliseRouteHexColor(routeColorGtfs);
  if (fromGtfs) return fromGtfs;
  return ROUTE_COLOR_FALLBACK_BY_SHORT_NAME[routeShortName] ?? ROUTE_COLOR_FALLBACK_DEFAULT;
};

export type RouteColorLookup = (routeId: string | null | undefined) => string;

export const createRouteColorLookup = (features: TrainTrackFeature[]): RouteColorLookup => {
  const shortNameOf = createRouteShortNameLookup(features);
  const colorByRouteId = new Map<string, string>();
  const colorByShortName = new Map<string, string>();
  for (const { properties } of features) {
    const { route_id: routeId, route_short_name: shortName, route_color: routeColor } = properties;
    const color = resolveTrainLineColor(shortName ?? "", routeColor ?? "");
    if (routeId && !colorByRouteId.has(routeId)) colorByRouteId.set(routeId, color);
    if (shortName && !colorByShortName.has(shortName)) colorByShortName.set(shortName, color);
  }

  return (routeId) => {
    if (!routeId) return ROUTE_COLOR_FALLBACK_DEFAULT;
    const direct = colorByRouteId.get(routeId);
    if (direct) return direct;
    const shortName = shortNameOf(routeId) ?? routeId;
    return colorByShortName.get(shortName) ?? resolveTrainLineColor(shortName, "");
  };
};

export const hexToRgb = (hex: string): [number, number, number] => {
  const digits = hex.replace("#", "");
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  const value = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(value)) return [0.6, 0.6, 0.6];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};
