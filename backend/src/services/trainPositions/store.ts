import type { TrainPosition, TrainPositions } from "../../types/train/train";
import { createSnapshotStore } from "../../utils/serviceCache";

const TRAIN_POSITIONS_KEY = "trainPositions:snapshot";

const defaultTrainPositions: TrainPositions = {
  items: [],
  fetchedAt: 0,
};

const trainPositionsStore = createSnapshotStore<TrainPositions>(
  TRAIN_POSITIONS_KEY,
  defaultTrainPositions
);

export const getTrainPositions = (): TrainPositions => {
  return trainPositionsStore.get();
};

export const setTrainPositions = (items: TrainPosition[], fetchedAt: number): void => {
  trainPositionsStore.set({
    items,
    fetchedAt,
  });
};

export const getTrainPositionsFetchPromise = (): Promise<void> | null => {
  return trainPositionsStore.getFetchPromise();
};

export const setTrainPositionsFetchPromise = (nextPromise: Promise<void> | null): void => {
  trainPositionsStore.setFetchPromise(nextPromise);
};
