import type { TripUpdateEntry, TripUpdates } from "../../types/train/tripUpdates";
import { createSnapshotStore } from "../../utils/serviceCache";

const TRIP_UPDATES_KEY = "tripUpdates:snapshot";

const defaultTripUpdates: TripUpdates = {
  items: [],
  fetchedAt: 0,
};

const tripUpdatesStore = createSnapshotStore<TripUpdates>(TRIP_UPDATES_KEY, defaultTripUpdates);

export const getTripUpdates = (): TripUpdates => {
  return tripUpdatesStore.get();
};

export const setTripUpdates = (items: TripUpdateEntry[], fetchedAt: number): void => {
  tripUpdatesStore.set({
    items,
    fetchedAt,
  });
};

export const getTripUpdatesFetchPromise = (): Promise<void> | null => {
  return tripUpdatesStore.getFetchPromise();
};

export const setTripUpdatesFetchPromise = (nextPromise: Promise<void> | null): void => {
  tripUpdatesStore.setFetchPromise(nextPromise);
};
