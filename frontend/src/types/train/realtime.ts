import type { TrainPositions } from "./train";
import type { TripUpdatesResponse } from "./tripUpdates";

export interface TrainRealtimeResponse {
  positions: TrainPositions;
  tripUpdates: TripUpdatesResponse;
}
