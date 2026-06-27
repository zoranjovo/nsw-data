import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { DateTime } from "luxon";
import type { TripUpdates } from "../../types/train/tripUpdates";
import { debugLog } from "../../utils/debug";
import { tfnswClient } from "../api";
import { getTripUpdates, setTripUpdates } from "./store";
import { mergeTripUpdateEntries, toTripUpdates } from "./utils";

const TFNSW_TRIP_UPDATES_URL = "https://api.transport.nsw.gov.au/v2/gtfs/realtime/sydneytrains";
const TRIP_UPDATES_TTL_MS = 15 * 1000;

let fetchPromise: Promise<void> | null = null;

export const fetchTripUpdates = async (): Promise<void> => {
  if (fetchPromise) {
    await fetchPromise;
    return;
  }

  fetchPromise = (async () => {
    const { data } = await tfnswClient.get<ArrayBuffer>(TFNSW_TRIP_UPDATES_URL, {
      responseType: "arraybuffer",
    });

    const binary = new Uint8Array(data);
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(binary);
    const incomingTripUpdates = toTripUpdates(feed);
    const previousTripUpdates = getTripUpdates().items;
    const tripUpdates = mergeTripUpdateEntries(previousTripUpdates, incomingTripUpdates);
    const fetchedAt = DateTime.now().toMillis();
    setTripUpdates(tripUpdates, fetchedAt);
    debugLog("FETCHED", `trip updates (${tripUpdates.length} items)`);
  })().finally(() => {
    fetchPromise = null;
  });

  await fetchPromise;
};

export const getTripUpdatesData = async (): Promise<TripUpdates> => {
  const tripUpdates = getTripUpdates();
  const now = DateTime.now().toMillis();
  if (tripUpdates.fetchedAt + TRIP_UPDATES_TTL_MS < now) {
    await fetchTripUpdates();
    return getTripUpdates();
  } else {
    return tripUpdates;
  }
};
