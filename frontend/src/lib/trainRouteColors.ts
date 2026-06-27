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

const FALLBACK_DEFAULT = "#999999";

export const normaliseRouteHexColor = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
};

export const resolveTrainLineColor = (routeShortName: string, routeColorGtfs: string): string => {
  const fromGtfs = normaliseRouteHexColor(routeColorGtfs);
  if (fromGtfs) return fromGtfs;
  return ROUTE_COLOR_FALLBACK_BY_SHORT_NAME[routeShortName] ?? FALLBACK_DEFAULT;
};
