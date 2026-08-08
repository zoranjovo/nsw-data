import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect } from "react";
import {
  ROUTE_COLOR_FALLBACK_BY_SHORT_NAME,
  ROUTE_COLOR_FALLBACK_DEFAULT,
} from "@/lib/trainRouteColors";
import { useAppContext } from "@/providers/AppProvider";
import { isMapRemoved, useMapLibre } from "../MapView/MapContext";
import { syncTrainOverlayLayerOrder, TRAIN_TRACKS_LAYER_ID } from "../trainMapLayers";

const SOURCE_ID = "train-tracks";
const LAYER_ID = TRAIN_TRACKS_LAYER_ID;

// Built from ROUTE_COLOR_FALLBACK_BY_SHORT_NAME so the fallback palette can't drift
// from the one used by resolveTrainLineColor().
const ROUTE_COLOR_MATCH_EXPRESSION = [
  "match",
  ["get", "route_short_name"],
  ...Object.entries(ROUTE_COLOR_FALLBACK_BY_SHORT_NAME).flat(),
  ROUTE_COLOR_FALLBACK_DEFAULT,
] as unknown as ExpressionSpecification;

const LINE_COLOR_EXPRESSION: ExpressionSpecification = [
  "case",
  ["has", "route_color"],
  ["concat", "#", ["get", "route_color"]],
  ROUTE_COLOR_MATCH_EXPRESSION,
];

export const TrainLines = () => {
  const map = useMapLibre();
  const { trainStatic } = useAppContext();

  useEffect(() => {
    if (!map) return;
    if (!trainStatic.tracks || trainStatic.tracks.features.length === 0) return;

    const addTrainLayer = () => {
      if (isMapRemoved(map)) return;
      if (map.getSource(SOURCE_ID)) return;
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: trainStatic.tracks as GeoJSON.FeatureCollection,
      });
      map.addLayer({
        id: LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": LINE_COLOR_EXPRESSION,
          "line-width": 4,
          "line-opacity": 0.5,
        },
      });
      syncTrainOverlayLayerOrder(map);
    };
    addTrainLayer();
    map.on("style.load", addTrainLayer);

    return () => {
      if (isMapRemoved(map)) return;
      map.off("style.load", addTrainLayer);
      if (map.getSource(SOURCE_ID)) {
        map.removeLayer(LAYER_ID);
        map.removeSource(SOURCE_ID);
      }
    };
  }, [map, trainStatic.tracks]);

  return null;
};
