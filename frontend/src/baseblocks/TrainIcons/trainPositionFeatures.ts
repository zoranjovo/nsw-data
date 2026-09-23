import { isSameTrain } from "@/lib/trainIdentity";
import type { TrainPosition } from "@/types/train/train";
import { isWithinBounds, type VisibleBounds } from "../MapView/mapViewport";

const STALE_POSITION_SECONDS = 10 * 60;

export type TrainDisplayPosition = {
  longitude: number;
  latitude: number;
  bearing: number | null;
};

export type TrainFeatureOptions = {
  nowEpochSeconds: number;
  bounds: VisibleBounds;
  selectedTrain: TrainPosition | null;
  resolveDisplayPosition: (position: TrainPosition, target: TrainDisplayPosition) => void;
};

export const buildTrainPositionFeatures = (
  positions: TrainPosition[],
  options: TrainFeatureOptions
): GeoJSON.Feature<GeoJSON.Point>[] => {
  const { nowEpochSeconds, bounds, selectedTrain, resolveDisplayPosition } = options;
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  const display: TrainDisplayPosition = { longitude: 0, latitude: 0, bearing: null };

  for (const position of positions) {
    resolveDisplayPosition(position, display);

    const isSelected = isSameTrain(position, selectedTrain);
    if (!isSelected && !isWithinBounds(bounds, display.longitude, display.latitude)) {
      continue;
    }

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [display.longitude, display.latitude] },
      properties: {
        routeId: position.routeId,
        vehicleId: position.vehicleId,
        vehicleLabel: position.vehicleLabel,
        tripId: position.tripId,
        speed: position.speed,
        timestamp: position.timestamp,
        bearing: display.bearing,
        hasBearing: display.bearing != null,
        isSelected,
        isStale:
          position.timestamp != null
            ? nowEpochSeconds - position.timestamp > STALE_POSITION_SECONDS
            : false,
      },
    });
  }

  return features;
};

export const trainPositionFeaturesKey = (features: GeoJSON.Feature<GeoJSON.Point>[]): string =>
  features
    .map(({ geometry, properties }) =>
      [
        properties?.tripId,
        properties?.vehicleId,
        geometry.coordinates[0].toFixed(6),
        geometry.coordinates[1].toFixed(6),
        properties?.bearing == null ? "" : Math.round(properties.bearing),
        properties?.isSelected,
        properties?.isStale,
        properties?.timestamp,
      ].join("|")
    )
    .join(";");
