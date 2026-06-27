import type { TrainAlert } from "@/types/train/alerts";
import type { TrainTrackProperties } from "@/types/train/tracks";
import { getRouteShortNameFromRouteId } from "./trainRouteId";

const routeIdMatchesLine = (routeId: string | null, line: TrainTrackProperties): boolean => {
  if (!routeId) return false;
  if (routeId === line.route_id) return true;
  return getRouteShortNameFromRouteId(routeId) === line.route_short_name;
};

export const alertsForLine = (line: TrainTrackProperties, alerts: TrainAlert[]): TrainAlert[] => {
  const out: TrainAlert[] = [];
  const seenIds = new Set<string>();

  for (const alert of alerts) {
    const matches = alert.informedEntities.some((e) => routeIdMatchesLine(e.routeId, line));
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
