export type AlertInformedEntity = {
  routeId: string | null;
  tripId: string | null;
  stopId: string | null;
};

export type TrainAlert = {
  id: string;
  cause: string | null;
  effect: string | null;
  headerText: string | null;
  descriptionText: string | null;
  url: string | null;
  activePeriods: Array<{
    start: number | null;
    end: number | null;
  }>;
  informedEntities: AlertInformedEntity[];
};

export type AlertsSnapshot = {
  alerts: TrainAlert[];
  fetchedAt: number;
  expiresAt: number;
};
