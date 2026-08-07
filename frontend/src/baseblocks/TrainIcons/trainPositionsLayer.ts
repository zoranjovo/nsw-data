import type { ExpressionSpecification, Map as MaplibreMap } from "maplibre-gl";
import { EMPTY_GEOJSON } from "../MapView/mapSources";
import { TRAIN_POSITIONS_LAYER_ID } from "../trainMapLayers";
import { registerTrainIconImages, TRAIN_ICON_IDS } from "./trainIconImages";

export const TRAIN_POSITIONS_SOURCE_ID = "train-positions";

const ICON_IMAGE = [
  "case",
  ["==", ["get", "hasBearing"], false],
  ["case", ["==", ["get", "isSelected"], true], TRAIN_ICON_IDS.dotSelected, TRAIN_ICON_IDS.dot],
  ["case", ["==", ["get", "isSelected"], true], TRAIN_ICON_IDS.arrowSelected, TRAIN_ICON_IDS.arrow],
] as ExpressionSpecification;

const ICON_ROTATE = ["coalesce", ["get", "bearing"], 0] as ExpressionSpecification;

const ICON_SIZE = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  0.3,
  11,
  0.6,
  14,
  0.95,
  17,
  1.4,
] as ExpressionSpecification;

const ICON_OPACITY = ["case", ["==", ["get", "isStale"], true], 0.4, 1] as ExpressionSpecification;

export const addTrainPositionsLayer = (map: MaplibreMap): void => {
  registerTrainIconImages(map);
  if (map.getSource(TRAIN_POSITIONS_SOURCE_ID)) return;

  map.addSource(TRAIN_POSITIONS_SOURCE_ID, { type: "geojson", data: EMPTY_GEOJSON });
  map.addLayer({
    id: TRAIN_POSITIONS_LAYER_ID,
    type: "symbol",
    source: TRAIN_POSITIONS_SOURCE_ID,
    layout: {
      "icon-image": ICON_IMAGE,
      "icon-size": ICON_SIZE,
      "icon-rotate": ICON_ROTATE,
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-opacity": ICON_OPACITY,
    },
  });
};

export const removeTrainPositionsLayer = (map: MaplibreMap): void => {
  if (!map.getSource(TRAIN_POSITIONS_SOURCE_ID)) return;
  map.removeLayer(TRAIN_POSITIONS_LAYER_ID);
  map.removeSource(TRAIN_POSITIONS_SOURCE_ID);
};
