const EXCLUDED_ROUTE_ID_PREFIX = "RTTA_";

export const isExcludedTrainRouteId = (routeId: string): boolean => {
  return routeId.startsWith(EXCLUDED_ROUTE_ID_PREFIX);
};
