import type { TrainPosition, TrainPositions } from "../../types/train/train";
import { getCached, setCached } from "../../utils/serviceCache";

const TRAIN_POSITIONS_KEY = "trainPositions:snapshot";

const defaultTrainPositions: TrainPositions = {
  items: [],
  fetchedAt: 0,
};

export const getTrainPositions = (): TrainPositions => {
  return getCached<TrainPositions>(TRAIN_POSITIONS_KEY) ?? defaultTrainPositions;
};

export const setTrainPositions = (items: TrainPosition[], fetchedAt: number): void => {
  setCached<TrainPositions>(TRAIN_POSITIONS_KEY, {
    items,
    fetchedAt,
  });
};
