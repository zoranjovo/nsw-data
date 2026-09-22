import type { TimetableData } from "../../types/train/timetable";
import { getTripUpdates } from "../tripUpdates/store";
import { getStaticTimetable } from "./store";
import { buildTrainTimetable } from "./utils";

export const getTripTimetableByTripId = (tripId: string): TimetableData | null => {
  const snapshot = getStaticTimetable();
  const tripUpdates = getTripUpdates();
  const tripUpdate = tripUpdates.items.find((item) => item.tripId === tripId) ?? null;

  return buildTrainTimetable({
    tripId,
    tripsById: snapshot.tripsById,
    stopTimesByTripId: snapshot.stopTimesByTripId,
    routesById: snapshot.routesById,
    stopsById: snapshot.stopsById,
    tripUpdate,
    tripUpdatesFetchedAt: tripUpdates.fetchedAt,
    staticTimetableFetchedAt: snapshot.fetchedAt,
  });
};
