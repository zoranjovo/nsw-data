import type { Map as MaplibreMap } from "maplibre-gl";

export const TRAIN_TRACKS_LAYER_ID = "train-tracks-layer";
export const TRAIN_STOPS_LAYER_ID = "train-stops-layer";
export const TRAIN_STOPS_LABELS_LAYER_ID = "train-stops-labels-layer";
export const TRAIN_POSITIONS_LAYER_ID = "train-positions-layer";
export const TRAIN_SELECTED_LAYER_ID = "train-positions-selected-layer";

export const STATION_LABEL_MIN_ZOOM = 13;

export const syncTrainOverlayLayerOrder = (map: MaplibreMap): void => {
  const has = (id: string) => Boolean(map.getLayer(id));

  if (has(TRAIN_STOPS_LAYER_ID) && has(TRAIN_POSITIONS_LAYER_ID)) {
    map.moveLayer(TRAIN_STOPS_LAYER_ID, TRAIN_POSITIONS_LAYER_ID);
  }
  if (has(TRAIN_TRACKS_LAYER_ID)) {
    if (has(TRAIN_STOPS_LAYER_ID)) {
      map.moveLayer(TRAIN_TRACKS_LAYER_ID, TRAIN_STOPS_LAYER_ID);
    } else if (has(TRAIN_POSITIONS_LAYER_ID)) {
      map.moveLayer(TRAIN_TRACKS_LAYER_ID, TRAIN_POSITIONS_LAYER_ID);
    }
  }
  if (has(TRAIN_POSITIONS_LAYER_ID)) {
    map.moveLayer(TRAIN_POSITIONS_LAYER_ID);
  }
  if (has(TRAIN_SELECTED_LAYER_ID)) {
    map.moveLayer(TRAIN_SELECTED_LAYER_ID);
  }
  if (has(TRAIN_STOPS_LABELS_LAYER_ID)) {
    map.moveLayer(TRAIN_STOPS_LABELS_LAYER_ID);
  }
};
