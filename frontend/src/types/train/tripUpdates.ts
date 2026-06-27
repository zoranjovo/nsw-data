export interface TripUpdateStopTime {
  stopId: string;
  arrivalDelaySeconds: number | null;
  departureDelaySeconds: number | null;
  realtimeArrivalTimestamp: number | null;
  realtimeDepartureTimestamp: number | null;
}

export interface TripUpdateEntry {
  tripId: string;
  routeId: string;
  vehicleId: string | null;
  serviceDate: string | null;
  stopTimeUpdates: TripUpdateStopTime[];
}

export interface TripUpdates {
  items: TripUpdateEntry[];
  fetchedAt: number;
}

export interface TripUpdateStopTimeResponse {
  stopId: string;
  arrivalDelaySeconds: number | null;
  departureDelaySeconds: number | null;
}

export interface TripUpdateEntryResponse {
  tripId: string;
  routeId: string;
  vehicleId: string | null;
  stopTimeUpdates: TripUpdateStopTimeResponse[];
}

export interface TripUpdatesResponse {
  items: TripUpdateEntryResponse[];
  fetchedAt: number;
}
