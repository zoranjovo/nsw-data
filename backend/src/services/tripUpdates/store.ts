import type { TripUpdateEntry, TripUpdates } from "../../types/train/tripUpdates";
import { getCached, setCached } from "../../utils/serviceCache";

const TRIP_UPDATES_KEY = "tripUpdates:snapshot";

const defaultTripUpdates: TripUpdates = {
  items: [],
  fetchedAt: 0,
};

export const getTripUpdates = (): TripUpdates => {
  return getCached<TripUpdates>(TRIP_UPDATES_KEY) ?? defaultTripUpdates;
};

export const setTripUpdates = (items: TripUpdateEntry[], fetchedAt: number): void => {
  setCached<TripUpdates>(TRIP_UPDATES_KEY, {
    items,
    fetchedAt,
  });
};
