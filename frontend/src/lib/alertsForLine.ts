import type { TrainAlert } from "@/types/train/alerts";
import type { TrainTrackProperties } from "@/types/train/tracks";
import type { RouteShortNameLookup } from "./trainRouteId";

export const alertsForLine = (
  line: TrainTrackProperties,
  alerts: TrainAlert[],
  getRouteShortName: RouteShortNameLookup
): TrainAlert[] => {
  const out: TrainAlert[] = [];
  const seenIds = new Set<string>();

  for (const alert of alerts) {
    const matches = alert.informedEntities.some(
      (e) => getRouteShortName(e.routeId) === line.route_short_name
    );
    if (!matches) continue;

    const id = alert.id?.trim();
    if (id) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }
    out.push(alert);
  }

  return out;
};
