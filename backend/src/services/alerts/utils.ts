import type GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { TrainAlert } from "../../types/train/alerts";

type DecodedFeed = ReturnType<typeof GtfsRealtimeBindings.transit_realtime.FeedMessage.decode>;

const getTranslatedText = (
  value: { translation?: Array<{ text?: string }> | null } | null | undefined
): string | null => {
  return value?.translation?.[0]?.text ?? null;
};

export const toTrainAlerts = (feed: DecodedFeed): TrainAlert[] => {
  const alerts: TrainAlert[] = [];

  for (const entity of feed.entity ?? []) {
    const alert = entity.alert;
    if (!alert) {
      continue;
    }

    alerts.push({
      id: entity.id ?? "",
      cause: alert.cause == null ? null : String(alert.cause),
      effect: alert.effect == null ? null : String(alert.effect),
      headerText: getTranslatedText(alert.headerText),
      descriptionText: getTranslatedText(alert.descriptionText),
      url: getTranslatedText(alert.url),
      activePeriods: (alert.activePeriod ?? []).map((period) => ({
        start: period.start == null ? null : Number(period.start),
        end: period.end == null ? null : Number(period.end),
      })),
      informedEntities: (alert.informedEntity ?? []).map((informedEntity) => ({
        routeId: informedEntity.routeId ?? null,
        tripId: informedEntity.trip?.tripId ?? null,
        stopId: informedEntity.stopId ?? null,
      })),
    });
  }

  return alerts;
};
