import type {
  StaticRoute,
  StaticStop,
  StaticStopTime,
  StaticTimetableSnapshot,
  StaticTrip,
} from "../../types/train/timetable";
import { getCached, setCached } from "../../utils/serviceCache";

const STATIC_TIMETABLE_KEY = "timetable:static";

const defaultStaticTimetable: StaticTimetableSnapshot = {
  stopsById: new Map<string, StaticStop>(),
  routesById: new Map<string, StaticRoute>(),
  tripsById: new Map<string, StaticTrip>(),
  stopTimesByTripId: new Map<string, StaticStopTime[]>(),
  tripIdsByRouteId: new Map<string, string[]>(),
  tripIdsByStopId: new Map<string, string[]>(),
  fetchedAt: 0,
};

let fetchPromise: Promise<void> | null = null;

export const getStaticTimetable = (): StaticTimetableSnapshot => {
  return getCached<StaticTimetableSnapshot>(STATIC_TIMETABLE_KEY) ?? defaultStaticTimetable;
};

export const setStaticTimetable = (snapshot: StaticTimetableSnapshot): void => {
  setCached<StaticTimetableSnapshot>(STATIC_TIMETABLE_KEY, snapshot);
};

export const getStaticTimetableFetchPromise = (): Promise<void> | null => {
  return fetchPromise;
};

export const setStaticTimetableFetchPromise = (nextPromise: Promise<void> | null): void => {
  fetchPromise = nextPromise;
};
