import { DateTime } from "luxon";
import type { TripUpdates } from "../../types/train/tripUpdates";
import { debugLog } from "../../utils/debug";
import { tfnswClient } from "../api";
import { fetchGtfsRealtimeFeed } from "../gtfsRealtime";
import { ensureFreshSnapshot } from "../snapshotFetch";
import {
  getTripUpdates,
  getTripUpdatesFetchPromise,
  setTripUpdates,
  setTripUpdatesFetchPromise,
} from "./store";
import { mergeTripUpdateEntries, toTripUpdates } from "./utils";

const TFNSW_TRIP_UPDATES_URL = "https://api.transport.nsw.gov.au/v2/gtfs/realtime/sydneytrains";
const TRIP_UPDATES_TTL_MS = 15 * 1000;

export const fetchTripUpdates = async (): Promise<void> => {
  const inflightPromise = getTripUpdatesFetchPromise();
  if (inflightPromise) {
    await inflightPromise;
    return;
  }

  const nextPromise = (async () => {
    const feed = await fetchGtfsRealtimeFeed(tfnswClient, TFNSW_TRIP_UPDATES_URL);
    const incomingTripUpdates = toTripUpdates(feed);
    const previousTripUpdates = getTripUpdates().items;
    const tripUpdates = mergeTripUpdateEntries(previousTripUpdates, incomingTripUpdates);
    const fetchedAt = DateTime.now().toMillis();
    setTripUpdates(tripUpdates, fetchedAt);
    debugLog("FETCHED", `trip updates (${tripUpdates.length} items)`);
  })().finally(() => {
    setTripUpdatesFetchPromise(null);
  });

  setTripUpdatesFetchPromise(nextPromise);
  await nextPromise;
};

export const getTripUpdatesData = async (): Promise<TripUpdates> => {
  return ensureFreshSnapshot(getTripUpdates, fetchTripUpdates, TRIP_UPDATES_TTL_MS);
};
