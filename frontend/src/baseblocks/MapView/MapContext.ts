import type { Map as MapLibreMap } from "maplibre-gl";
import { createContext, useContext } from "react";

export const MapContext = createContext<MapLibreMap | null>(null);

export const useMapLibre = (): MapLibreMap | null => {
  return useContext(MapContext);
};
