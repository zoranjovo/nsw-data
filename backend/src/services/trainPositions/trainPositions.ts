import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { DateTime } from "luxon";
import type { TrainPositions } from "../../types/train/train";
import { debugLog } from "../../utils/debug";
import { tfnswClient } from "../api";
import { getTrainPositions, setTrainPositions } from "./store";
import { toTrainPositions } from "./utils";

const TFNSW_VEHICLE_POS_URL = "https://api.transport.nsw.gov.au/v2/gtfs/vehiclepos/sydneytrains";
const TRAIN_POSITIONS_TTL_MS = 15 * 1000;

let fetchPromise: Promise<void> | null = null;

export const fetchTrainPositions = async (): Promise<void> => {
  if (fetchPromise) {
    await fetchPromise;
    return;
  }

  fetchPromise = (async () => {
    const { data } = await tfnswClient.get<ArrayBuffer>(TFNSW_VEHICLE_POS_URL, {
      responseType: "arraybuffer",
    });

    const binary = new Uint8Array(data);
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(binary);
    const positions = toTrainPositions(feed);
    const fetchedAt = DateTime.now().toMillis();
    setTrainPositions(positions, fetchedAt);
    debugLog("FETCHED", `train positions (${positions.length} items)`);
  })().finally(() => {
    fetchPromise = null;
  });

  await fetchPromise;
};

export const getTrainPositionsData = async (): Promise<TrainPositions> => {
  const positions = getTrainPositions();
  const now = DateTime.now().toMillis();
  if (positions.fetchedAt + TRAIN_POSITIONS_TTL_MS < now) {
    await fetchTrainPositions();
    return getTrainPositions();
  } else {
    return positions;
  }
};
