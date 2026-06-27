import { DateTime } from "luxon";
import {
  checkStaticAssets,
  refreshStaticAssetsIfNewCalendarDay,
} from "../services/staticData/staticData";
import { loadStaticTimetableFromAssets } from "../services/timetable/timetable";
import { fetchTrainPositions } from "../services/trainPositions/trainPositions";
import { fetchTripUpdates } from "../services/tripUpdates/tripUpdates";
import { debugLog } from "../utils/debug";

const INACTIVITY_TIMEOUT_MS = 60 * 1000;
const FAST_TICK_INTERVAL_MS = 15 * 1000; // 15 sec
const SLOW_TICK_INTERVAL_MS = 15 * 60 * 1000; // 15 min

export const appState = {
  isReady: false,
  isActive: false,
  lastApiRequestAt: 0,
};

let interval: ReturnType<typeof setInterval> | null = null;

const fastTick = () => {
  if (DateTime.now().toMillis() - appState.lastApiRequestAt > INACTIVITY_TIMEOUT_MS) {
    appState.isActive = false;
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    debugLog("SLEEPING", "app gone inactive");
    return;
  }
  void fetchTrainPositions();
  void fetchTripUpdates();
};

const slowTick = () => {
  void (async () => {
    try {
      const didRefresh = await refreshStaticAssetsIfNewCalendarDay();
      if (didRefresh) {
        await loadStaticTimetableFromAssets(true);
      }
    } catch (error) {
      debugLog(
        "STATIC",
        `daily static refresh failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  })();
};

export const wakeUpApp = async () => {
  if (appState.isActive) {
    return;
  }
  appState.isActive = true;
  appState.lastApiRequestAt = DateTime.now().toMillis();
  interval = setInterval(fastTick, FAST_TICK_INTERVAL_MS);
  debugLog("WAKING UP", "app is now active");
};

export const initialiseApp = async () => {
  await checkStaticAssets();
  await refreshStaticAssetsIfNewCalendarDay();
  await loadStaticTimetableFromAssets();
  await Promise.all([fetchTrainPositions(), fetchTripUpdates()]);
  setInterval(slowTick, SLOW_TICK_INTERVAL_MS);
  appState.isReady = true;
  debugLog("INITIALISED", "app is now ready");
};
