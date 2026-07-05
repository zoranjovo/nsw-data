import type {
  StaticRoute,
  StaticStop,
  StaticStopTime,
  StaticTimetableSnapshot,
  StaticTrip,
} from "../../types/train/timetable";
import { createSnapshotStore } from "../../utils/serviceCache";

const STATIC_TIMETABLE_KEY = "timetable:static";

const defaultStaticTimetable: StaticTimetableSnapshot = {
  stopsById: new Map<string, StaticStop>(),
  routesById: new Map<string, StaticRoute>(),
  tripsById: new Map<string, StaticTrip>(),
  stopTimesByTripId: new Map<string, StaticStopTime[]>(),
  fetchedAt: 0,
};

const staticTimetableStore = createSnapshotStore<StaticTimetableSnapshot>(
  STATIC_TIMETABLE_KEY,
  defaultStaticTimetable
);

export const getStaticTimetable = (): StaticTimetableSnapshot => {
  return staticTimetableStore.get();
};

export const setStaticTimetable = (snapshot: StaticTimetableSnapshot): void => {
  staticTimetableStore.set(snapshot);
};

export const getStaticTimetableFetchPromise = (): Promise<void> | null => {
  return staticTimetableStore.getFetchPromise();
};

export const setStaticTimetableFetchPromise = (nextPromise: Promise<void> | null): void => {
  staticTimetableStore.setFetchPromise(nextPromise);
};
