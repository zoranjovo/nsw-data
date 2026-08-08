import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl";

export const EMPTY_GEOJSON: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export const getGeoJSONSource = (map: MaplibreMap, sourceId: string): GeoJSONSource | undefined =>
  map.getSource(sourceId) as GeoJSONSource | undefined;
