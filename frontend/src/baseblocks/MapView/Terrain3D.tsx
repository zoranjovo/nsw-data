import type { Map as MaplibreMap, SkySpecification } from "maplibre-gl";
import { useEffect } from "react";
import { syncTrainOverlayLayerOrder } from "../trainMapLayers";
import { isMapRemoved, isStyleReady, useMapLibre } from "./MapContext";
import { getTerrainTheme, HILLSHADE_LAYER_ID, TERRAIN_SOURCE, TERRAIN_SOURCE_ID } from "./terrain";

const firstSymbolLayerId = (map: MaplibreMap): string | undefined =>
  map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;

const removeSky = (map: MaplibreMap): void => {
  (map as unknown as { setSky: (sky?: SkySpecification) => void }).setSky();
};

type Props = { enabled: boolean; layerId: string };

export const Terrain3D = ({ enabled, layerId }: Props) => {
  const map = useMapLibre();

  useEffect(() => {
    if (!map || !enabled) return;

    const theme = getTerrainTheme(layerId);

    const applyTerrain = () => {
      if (isMapRemoved(map)) return;

      if (!map.getSource(TERRAIN_SOURCE_ID)) {
        map.addSource(TERRAIN_SOURCE_ID, TERRAIN_SOURCE);
      }

      if (theme.hillshade && !map.getLayer(HILLSHADE_LAYER_ID)) {
        map.addLayer(
          {
            id: HILLSHADE_LAYER_ID,
            type: "hillshade",
            source: TERRAIN_SOURCE_ID,
            paint: theme.hillshade,
          },
          firstSymbolLayerId(map)
        );
      }

      map.setTerrain({ source: TERRAIN_SOURCE_ID });
      map.setSky(theme.sky);
      syncTrainOverlayLayerOrder(map);
    };

    if (!isMapRemoved(map) && isStyleReady(map)) {
      applyTerrain();
    }
    map.on("style.load", applyTerrain);

    return () => {
      if (isMapRemoved(map)) return;
      map.off("style.load", applyTerrain);
      if (!isStyleReady(map)) return;
      map.setTerrain(null);
      removeSky(map);
      if (map.getLayer(HILLSHADE_LAYER_ID)) {
        map.removeLayer(HILLSHADE_LAYER_ID);
      }
      if (map.getSource(TERRAIN_SOURCE_ID)) {
        map.removeSource(TERRAIN_SOURCE_ID);
      }
    };
  }, [map, enabled, layerId]);

  return null;
};
