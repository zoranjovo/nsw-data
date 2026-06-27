export type TrainStop = {
  stopId: string;
  stopName: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type TrainStopsResponse = TrainStop[];
