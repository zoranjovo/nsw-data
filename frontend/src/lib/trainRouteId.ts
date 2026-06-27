export const getRouteShortNameFromRouteId = (routeId: string | null | undefined): string | null => {
  if (!routeId) return null;
  const [firstSection] = routeId.split("_");
  return firstSection || null;
};
