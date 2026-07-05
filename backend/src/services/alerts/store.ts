import type { AlertsSnapshot } from "../../types/train/alerts";
import { createSnapshotStore } from "../../utils/serviceCache";

const ALERTS_KEY = "alerts:snapshot";

const defaultAlerts: AlertsSnapshot = {
  alerts: [],
  fetchedAt: 0,
  expiresAt: 0,
};

const alertsStore = createSnapshotStore<AlertsSnapshot>(ALERTS_KEY, defaultAlerts);

export const getAlertsSnapshotData = (): AlertsSnapshot => {
  return alertsStore.get();
};

export const setAlertsSnapshotData = (snapshot: AlertsSnapshot): void => {
  alertsStore.set(snapshot);
};

export const getAlertsFetchPromise = (): Promise<void> | null => {
  return alertsStore.getFetchPromise();
};

export const setAlertsFetchPromise = (nextPromise: Promise<void> | null): void => {
  alertsStore.setFetchPromise(nextPromise);
};
