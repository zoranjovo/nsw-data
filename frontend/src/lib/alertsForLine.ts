import type { TrainAlert } from "@/types/train/alerts";
import type { TrainTrackProperties } from "@/types/train/tracks";
import type { RouteShortNameLookup } from "./trainRouteId";

const isAlertActive = (alert: TrainAlert, nowSeconds: number): boolean =>
  alert.activePeriods.length === 0 ||
  alert.activePeriods.some(
    ({ start, end }) => (!start || start <= nowSeconds) && (!end || nowSeconds < end)
  );

export const alertsForLine = (
  line: TrainTrackProperties,
  alerts: TrainAlert[],
  getRouteShortName: RouteShortNameLookup
): TrainAlert[] => {
  const out: TrainAlert[] = [];
  const seenIds = new Set<string>();
  const nowSeconds = Date.now() / 1000;

  for (const alert of alerts) {
    if (!isAlertActive(alert, nowSeconds)) continue;
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
