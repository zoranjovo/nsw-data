import type { AlertsSnapshot } from "../../types/train/alerts";
import { getCached, setCached } from "../../utils/serviceCache";

const ALERTS_KEY = "alerts:snapshot";

const defaultAlerts: AlertsSnapshot = {
  alerts: [],
  fetchedAt: 0,
  expiresAt: 0,
};

let fetchPromise: Promise<void> | null = null;

export const getAlertsSnapshotData = (): AlertsSnapshot => {
  return getCached<AlertsSnapshot>(ALERTS_KEY) ?? defaultAlerts;
};

export const setAlertsSnapshotData = (snapshot: AlertsSnapshot): void => {
  setCached<AlertsSnapshot>(ALERTS_KEY, snapshot);
};

export const getAlertsFetchPromise = (): Promise<void> | null => {
  return fetchPromise;
};

export const setAlertsFetchPromise = (nextPromise: Promise<void> | null): void => {
  fetchPromise = nextPromise;
};
