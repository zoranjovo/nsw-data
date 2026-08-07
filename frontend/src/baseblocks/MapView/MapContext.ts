import type { Map as MapLibreMap } from "maplibre-gl";
import { createContext, useContext } from "react";

export const MapContext = createContext<MapLibreMap | null>(null);

export const useMapLibre = (): MapLibreMap | null => {
  return useContext(MapContext);
};

export const isMapRemoved = (map: MapLibreMap): boolean =>
  Boolean((map as { _removed?: boolean })._removed);

export const isStyleReady = (map: MapLibreMap): boolean =>
  Boolean((map as { style?: { _loaded?: boolean } }).style?._loaded);
