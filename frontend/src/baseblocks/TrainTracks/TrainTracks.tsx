import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect } from "react";
import { useAppContext } from "@/providers/AppProvider";
import { useMapLibre } from "../MapView/MapContext";
import { syncTrainOverlayLayerOrder, TRAIN_TRACKS_LAYER_ID } from "../trainMapLayers";

const SOURCE_ID = "train-tracks";
const LAYER_ID = TRAIN_TRACKS_LAYER_ID;

const LINE_COLOR_EXPRESSION: ExpressionSpecification = [
  "case",
  ["has", "route_color"],
  ["concat", "#", ["get", "route_color"]],
  [
    "match",
    ["get", "route_short_name"],
    "T1",
    "#F99D1C",
    "T2",
    "#00A651",
    "T3",
    "#8B4513",
    "T4",
    "#F26522",
    "T5",
    "#E4002B",
    "T6",
    "#00A3E0",
    "T7",
    "#00B5AD",
    "T8",
    "#E4007C",
    "T9",
    "#6C3F97",
    "#999999",
  ],
];

export const TrainLines = () => {
  const map = useMapLibre();
  const { trainStatic } = useAppContext();

  useEffect(() => {
    if (!map) return;
    if (!trainStatic.tracks || trainStatic.tracks.features.length === 0) return;
    const isMapRemoved = () => Boolean((map as { _removed?: boolean })._removed);

    const addTrainLayer = () => {
      if (isMapRemoved()) return;
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
      if (isMapRemoved()) return;
      map.off("style.load", addTrainLayer);
      if (map.getSource(SOURCE_ID)) {
        map.removeLayer(LAYER_ID);
        map.removeSource(SOURCE_ID);
      }
    };
  }, [map, trainStatic.tracks]);

  return null;
};
