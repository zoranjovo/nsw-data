import { DateTime } from "luxon";
import type { TrainPositions } from "../../types/train/train";
import { debugLog } from "../../utils/debug";
import { tfnswClient } from "../api";
import { fetchGtfsRealtimeFeed } from "../gtfsRealtime";
import { ensureFreshSnapshot } from "../snapshotFetch";
import {
  getTrainPositions,
  getTrainPositionsFetchPromise,
  setTrainPositions,
  setTrainPositionsFetchPromise,
} from "./store";
import { toTrainPositions } from "./utils";

const TFNSW_VEHICLE_POS_URL = "https://api.transport.nsw.gov.au/v2/gtfs/vehiclepos/sydneytrains";
const TRAIN_POSITIONS_TTL_MS = 15 * 1000;

export const fetchTrainPositions = async (): Promise<void> => {
  const inflightPromise = getTrainPositionsFetchPromise();
  if (inflightPromise) {
    await inflightPromise;
    return;
  }

  const nextPromise = (async () => {
    const feed = await fetchGtfsRealtimeFeed(tfnswClient, TFNSW_VEHICLE_POS_URL);
    const positions = toTrainPositions(feed);
    const fetchedAt = DateTime.now().toMillis();
    setTrainPositions(positions, fetchedAt);
    debugLog("FETCHED", `train positions (${positions.length} items)`);
  })().finally(() => {
    setTrainPositionsFetchPromise(null);
  });

  setTrainPositionsFetchPromise(nextPromise);
  await nextPromise;
};

export const getTrainPositionsData = async (): Promise<TrainPositions> => {
  return ensureFreshSnapshot(getTrainPositions, fetchTrainPositions, TRAIN_POSITIONS_TTL_MS);
};
