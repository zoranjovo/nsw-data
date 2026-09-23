import type { TrainTrackFeature } from "@/types/train/tracks";

export type RouteShortNameLookup = (routeId: string | null | undefined) => string | null;

const getRouteIdPrefix = (routeId: string): string => routeId.split("_")[0];

export const createRouteShortNameLookup = (features: TrainTrackFeature[]): RouteShortNameLookup => {
  const shortNameByRouteId = new Map<string, string>();
  const shortNameByPrefix = new Map<string, string | null>();
  for (const { properties } of features) {
    const { route_id: routeId, route_short_name: shortName } = properties;
    if (!routeId || !shortName) continue;
    shortNameByRouteId.set(routeId, shortName);
    const prefix = getRouteIdPrefix(routeId);
    const prefixShortName = shortNameByPrefix.get(prefix);
    shortNameByPrefix.set(
      prefix,
      prefixShortName === undefined || prefixShortName === shortName ? shortName : null
    );
  }

  return (routeId) => {
    if (!routeId) return null;
    return (
      shortNameByRouteId.get(routeId) ?? shortNameByPrefix.get(getRouteIdPrefix(routeId)) ?? null
    );
  };
};
