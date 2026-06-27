import type maplibregl from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { useAppContext } from "@/providers/AppProvider";
import type { TrainStopsResponse } from "@/types/train/stops";
import { useMapLibre } from "../MapView/MapContext";
import {
  STATION_LABEL_MIN_ZOOM,
  syncTrainOverlayLayerOrder,
  TRAIN_STOPS_LABELS_LAYER_ID,
  TRAIN_STOPS_LAYER_ID,
} from "../trainMapLayers";

const SOURCE_ID = "train-stops";
const LAYER_ID = TRAIN_STOPS_LAYER_ID;

const EMPTY_GEOJSON: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const stopsToGeoJSON = (stops: TrainStopsResponse): GeoJSON.FeatureCollection => {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = stops
    .filter((stop) => stop.latitude != null && stop.longitude != null)
    .map((stop) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [stop.longitude as number, stop.latitude as number],
      },
      properties: {
        stopId: stop.stopId,
        stopName: stop.stopName,
      },
    }));

  return {
    type: "FeatureCollection",
    features,
  };
};

export const TrainStations = () => {
  const map = useMapLibre();
  const { trainStatic } = useAppContext();
  const geojsonData = useMemo(() => stopsToGeoJSON(trainStatic.stops), [trainStatic.stops]);

  useEffect(() => {
    if (!map) return;
    const isMapRemoved = () => Boolean((map as { _removed?: boolean })._removed);

    const addTrainStopsLayer = () => {
      if (isMapRemoved()) return;
      if (map.getSource(SOURCE_ID)) return;
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: EMPTY_GEOJSON,
      });
      map.addLayer({
        id: LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": 3,
          "circle-color": "#F99D1C",
          "circle-opacity": 0.8,
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1,
        },
      });
      map.addLayer({
        id: TRAIN_STOPS_LABELS_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        minzoom: STATION_LABEL_MIN_ZOOM,
        layout: {
          "text-field": ["get", "stopName"],
          "text-font": ["Montserrat Medium"],
          "text-size": 13,
          "text-offset": [0, 0.8],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#fff",
          "text-halo-color": "#000",
          "text-halo-width": 0.5,
        },
      });
      syncTrainOverlayLayerOrder(map);

      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(geojsonData);
      }
    };
    addTrainStopsLayer();
    map.on("style.load", addTrainStopsLayer);

    return () => {
      if (isMapRemoved()) return;
      map.off("style.load", addTrainStopsLayer);
      if (map.getSource(SOURCE_ID)) {
        if (map.getLayer(TRAIN_STOPS_LABELS_LAYER_ID)) {
          map.removeLayer(TRAIN_STOPS_LABELS_LAYER_ID);
        }
        map.removeLayer(LAYER_ID);
        map.removeSource(SOURCE_ID);
      }
    };
  }, [map, geojsonData]);

  useEffect(() => {
    if (!map) return;
    const isMapRemoved = () => Boolean((map as { _removed?: boolean })._removed);
    if (isMapRemoved()) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(geojsonData);
      return;
    }

    const syncAfterStyleLoad = () => {
      const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(geojsonData);
      }
    };

    if (!isMapRemoved() && map.isStyleLoaded()) {
      syncAfterStyleLoad();
    } else {
      map.once("style.load", syncAfterStyleLoad);
    }
  }, [map, geojsonData]);

  return null;
};
