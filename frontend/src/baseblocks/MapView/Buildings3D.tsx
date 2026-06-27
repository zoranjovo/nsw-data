import { useEffect } from "react";
import { syncTrainOverlayLayerOrder } from "../trainMapLayers";
import { useMapLibre } from "./MapContext";

const SOURCE_ID = "openfreemap-buildings";
const LAYER_ID = "3d-buildings";
const DEFAULT_BUILDING_LAYER_IDS = ["building", "building-top"] as const;

type ThemeColors = { low: string; mid: string; high: string; opacity: number };

const THEME_COLORS: Record<string, ThemeColors> = {
  dark: { low: "#52525b", mid: "#3f3f46", high: "#27272a", opacity: 0.9 },
  light: { low: "#e4e4e7", mid: "#d4d4d8", high: "#a1a1aa", opacity: 0.85 },
  street: { low: "#dde0e8", mid: "#c8ccd6", high: "#9da3b0", opacity: 0.8 },
  satellite: { low: "#dde0e8", mid: "#c8ccd6", high: "#9da3b0", opacity: 0.8 },
};

const getThemeColors = (layerId: string): ThemeColors => {
  return THEME_COLORS[layerId] ?? THEME_COLORS.dark;
};

type Props = { layerId: string };

export const Buildings3D = ({ layerId }: Props) => {
  const map = useMapLibre();

  useEffect(() => {
    if (!map || layerId === "satellite") return;
    const isMapRemoved = () => Boolean((map as { _removed?: boolean })._removed);

    const { low, mid, high, opacity } = getThemeColors(layerId);

    const setDefaultBuildingVisibility = (visibility: "visible" | "none") => {
      if (isMapRemoved()) return;
      for (const id of DEFAULT_BUILDING_LAYER_IDS) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", visibility);
        }
      }
    };

    const addBuildingsLayer = () => {
      if (isMapRemoved()) return;
      setDefaultBuildingVisibility("none");

      if (map.getSource(SOURCE_ID)) return;

      map.addSource(SOURCE_ID, {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
      });

      map.addLayer({
        id: LAYER_ID,
        source: SOURCE_ID,
        "source-layer": "building",
        type: "fill-extrusion",
        minzoom: 14,
        filter: ["!=", ["get", "hide_3d"], true],
        paint: {
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "render_height"], 0],
            0,
            low,
            200,
            mid,
            400,
            high,
          ],
          "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, opacity],
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 0],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        },
      });
      syncTrainOverlayLayerOrder(map);
    };

    if (!isMapRemoved() && map.isStyleLoaded()) {
      addBuildingsLayer();
    } else {
      map.once("style.load", addBuildingsLayer);
    }
    map.on("style.load", addBuildingsLayer);

    return () => {
      if (isMapRemoved()) return;
      map.off("style.load", addBuildingsLayer);
      setDefaultBuildingVisibility("visible");
      if (map.getLayer(LAYER_ID)) {
        map.removeLayer(LAYER_ID);
      }
      if (map.getSource(SOURCE_ID)) {
        map.removeSource(SOURCE_ID);
      }
    };
  }, [map, layerId]);

  return null;
};
