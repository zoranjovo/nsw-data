export type TimetableStop = {
  stopId: string;
  stopName: string | null;
  stopSequence: number;
  hasRealtimeStopUpdate: boolean;
  skipped: boolean;
  latitude: number | null;
  longitude: number | null;
  scheduledArrival: string | null;
  scheduledDeparture: string | null;
  scheduledArrivalSeconds: number | null;
  scheduledDepartureSeconds: number | null;
  scheduledArrivalTimestamp: number | null;
  scheduledDepartureTimestamp: number | null;
  realtimeArrivalTimestamp: number | null;
  realtimeDepartureTimestamp: number | null;
  arrivalDelaySeconds: number | null;
  departureDelaySeconds: number | null;
};

export type TimetableProgress = {
  currentStopId: string | null;
  currentStopName: string | null;
  currentStopSequence: number | null;
  nextStopId: string | null;
  nextStopName: string | null;
  nextStopSequence: number | null;
};

export type TimetableData = {
  tripId: string;
  routeId: string;
  routeShortName: string | null;
  routeLongName: string | null;
  tripHeadsign: string | null;
  vehicleId: string | null;
  cancelled: boolean;
  tripUpdatesFetchedAt: number | null;
  staticTimetableFetchedAt: number | null;
  progress: TimetableProgress | null;
  stops: TimetableStop[];
};

export const isTimetableData = (value: unknown): value is TimetableData => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TimetableData>;
  return typeof candidate.tripId === "string" && Array.isArray(candidate.stops);
};

export type StaticStop = {
  stopId: string;
  stopName: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type StaticRoute = {
  routeId: string;
  routeShortName: string | null;
  routeLongName: string | null;
};

export type StaticTrip = {
  tripId: string;
  routeId: string;
  serviceId: string | null;
  tripHeadsign: string | null;
};

export type StaticStopTime = {
  tripId: string;
  stopId: string;
  arrivalTime: string | null;
  departureTime: string | null;
  arrivalSeconds: number | null;
  departureSeconds: number | null;
  stopSequence: number;
};

export type StaticTimetableSnapshot = {
  stopsById: Map<string, StaticStop>;
  routesById: Map<string, StaticRoute>;
  tripsById: Map<string, StaticTrip>;
  stopTimesByTripId: Map<string, StaticStopTime[]>;
  tripIdsByRouteId: Map<string, string[]>;
  tripIdsByStopId: Map<string, string[]>;
  fetchedAt: number;
};
