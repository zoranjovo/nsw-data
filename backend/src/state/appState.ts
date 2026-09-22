import { setTimeout as sleep } from "node:timers/promises";
import { DateTime } from "luxon";
import {
  checkStaticAssets,
  refreshStaticAssetsIfNewCalendarDay,
} from "../services/staticData/staticData";
import { loadStaticTimetableFromAssets } from "../services/timetable/timetable";
import { fetchTrainPositions } from "../services/trainPositions/trainPositions";
import { fetchTripUpdates } from "../services/tripUpdates/tripUpdates";
import { debugLog } from "../utils/debug";
import { describeError } from "../utils/errors";

const INACTIVITY_TIMEOUT_MS = 60 * 1000;
const FAST_TICK_INTERVAL_MS = 15 * 1000; // 15 sec
const SLOW_TICK_INTERVAL_MS = 15 * 60 * 1000; // 15 min
const INIT_RETRY_BASE_DELAY_MS = 15 * 1000;
const INIT_RETRY_MAX_DELAY_MS = 5 * 60 * 1000;

export const appState = {
  isReady: false,
  isActive: false,
  lastApiRequestAt: 0,
};

let interval: ReturnType<typeof setInterval> | null = null;

const refreshRealtime = async (): Promise<void> => {
  const results = await Promise.allSettled([fetchTrainPositions(), fetchTripUpdates()]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`Realtime refresh failed: ${describeError(result.reason)}`);
    }
  }
};

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
  void refreshRealtime();
};

const slowTick = () => {
  void (async () => {
    try {
      const didRefresh = await refreshStaticAssetsIfNewCalendarDay();
      if (didRefresh) {
        await loadStaticTimetableFromAssets(true);
      }
    } catch (error) {
      console.error(
        `Daily static refresh failed, keeping previous timetable assets: ${describeError(error)}`
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

const loadInitialData = async () => {
  await checkStaticAssets();
  try {
    await refreshStaticAssetsIfNewCalendarDay();
  } catch (error) {
    console.error(
      `Static refresh failed on startup, using existing assets: ${describeError(error)}`
    );
  }
  await loadStaticTimetableFromAssets();
  await refreshRealtime();
};

export const initialiseApp = async () => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await loadInitialData();
      break;
    } catch (error) {
      const delayMs = Math.min(
        INIT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
        INIT_RETRY_MAX_DELAY_MS
      );
      console.error(
        `Startup failed (attempt ${attempt}), retrying in ${delayMs / 1000}s: ${describeError(error)}`
      );
      await sleep(delayMs);
    }
  }
  setInterval(slowTick, SLOW_TICK_INTERVAL_MS);
  appState.isReady = true;
  debugLog("INITIALISED", "app is now ready");
};
