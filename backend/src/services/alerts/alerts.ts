import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { DateTime } from "luxon";
import type { TrainAlert } from "../../types/train/alerts";
import { debugLog } from "../../utils/debug";
import { tfnswClient } from "../api";
import {
  getAlertsFetchPromise,
  getAlertsSnapshotData,
  setAlertsFetchPromise,
  setAlertsSnapshotData,
} from "./store";
import { toTrainAlerts } from "./utils";

const ALERTS_TTL_MS = 30 * 1000; // 30 seconds
const TFNSW_ALERTS_URL = "https://api.transport.nsw.gov.au/v2/gtfs/alerts/sydneytrains";

const fetchAlerts = async (): Promise<void> => {
  debugLog("ALERT", `fetch ${TFNSW_ALERTS_URL}`);
  const { data } = await tfnswClient.get<ArrayBuffer>(TFNSW_ALERTS_URL, {
    responseType: "arraybuffer",
  });

  const binary = new Uint8Array(data);
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(binary);
  const alerts = toTrainAlerts(feed);
  const fetchedAt = DateTime.now().toMillis();
  setAlertsSnapshotData({
    alerts,
    fetchedAt,
    expiresAt: fetchedAt + ALERTS_TTL_MS,
  });
  debugLog("ALERT", `cached alerts=${alerts.length}`);
};

export const ensureAlertsFresh = async (force = false): Promise<void> => {
  const now = DateTime.now().toMillis();
  const snapshot = getAlertsSnapshotData();
  if (!force && snapshot.alerts.length > 0 && now < snapshot.expiresAt) {
    return;
  }

  const fetchPromise = getAlertsFetchPromise();
  if (fetchPromise) {
    await fetchPromise;
    return;
  }

  const nextPromise = fetchAlerts()
    .catch((error) => {
      const staleSnapshot = getAlertsSnapshotData();
      if (staleSnapshot.alerts.length > 0) {
        debugLog(
          "ALERT",
          `refresh failed, keeping stale cache: ${error instanceof Error ? error.message : String(error)}`
        );
        setAlertsSnapshotData({
          ...staleSnapshot,
          expiresAt: DateTime.now().toMillis() + 5_000,
        });
        return;
      }
      throw error;
    })
    .finally(() => {
      setAlertsFetchPromise(null);
    });
  setAlertsFetchPromise(nextPromise);
  await nextPromise;
};

export const getAlerts = async (): Promise<{ alerts: TrainAlert[]; fetchedAt: number | null }> => {
  await ensureAlertsFresh();
  const snapshot = getAlertsSnapshotData();
  return {
    alerts: snapshot.alerts,
    fetchedAt: snapshot.fetchedAt || null,
  };
};
