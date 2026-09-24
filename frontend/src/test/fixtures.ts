import type { LiveTrainData, TrainRealtimeState } from "@/providers/AppProvider";
import type { TimetableData, TimetableStop } from "@/types/train/timetable";
import type { TrainPosition } from "@/types/train/train";

export const makeStop = (
  stopSequence: number,
  stopName: string,
  arrival: number | null,
  departure: number | null = arrival,
  overrides: Partial<TimetableStop> = {}
): TimetableStop => ({
  stopId: `stop-${stopSequence}`,
  stopName,
  stopSequence,
  hasRealtimeStopUpdate: false,
  skipped: false,
  latitude: null,
  longitude: null,
  scheduledArrival: null,
  scheduledDeparture: null,
  scheduledArrivalSeconds: null,
  scheduledDepartureSeconds: null,
  scheduledArrivalTimestamp: arrival,
  scheduledDepartureTimestamp: departure,
  realtimeArrivalTimestamp: null,
  realtimeDepartureTimestamp: null,
  arrivalDelaySeconds: null,
  departureDelaySeconds: null,
  ...overrides,
});

export const makeTimetable = (
  tripId: string,
  stops: TimetableStop[],
  tripUpdatesFetchedAt: number | null = 0
): TimetableData => ({
  tripId,
  routeId: "T1",
  routeShortName: "T1",
  routeLongName: null,
  tripHeadsign: null,
  vehicleId: null,
  cancelled: false,
  tripUpdatesFetchedAt,
  staticTimetableFetchedAt: null,
  progress: null,
  stops,
});

export const makeTrain = (
  tripId: string,
  overrides: Partial<TrainPosition> = {}
): TrainPosition => ({
  tripId,
  routeId: "T1",
  vehicleId: `vehicle-${tripId}`,
  vehicleLabel: `Train ${tripId}`,
  latitude: -33.87,
  longitude: 151.21,
  timestamp: null,
  ...overrides,
});

export const makeRealtime = (
  positions: TrainPosition[] = [],
  tripUpdatesFetchedAt = 0
): TrainRealtimeState => ({
  status: "ready",
  positions: { items: positions, fetchedAt: 0 },
  tripUpdates: { items: [], fetchedAt: tripUpdatesFetchedAt },
  error: null,
});

export const makeLiveTrainData = (overrides: Partial<LiveTrainData> = {}): LiveTrainData => ({
  trainRealtime: makeRealtime(),
  timetables: new Map(),
  cacheTimetable: () => {},
  cacheTimetables: () => {},
  ...overrides,
});
