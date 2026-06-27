export type TrainPositions = {
  items: TrainPosition[];
  fetchedAt: number;
};

export type TrainPosition = {
  tripId: string;
  routeId: string;
  vehicleId: string;
  vehicleLabel: string;
  latitude: number;
  longitude: number;
  timestamp: number | null;
  bearing?: number | null;
  speed?: number | null;
  currentStopSequence?: number | null;
};
