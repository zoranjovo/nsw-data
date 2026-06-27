import type { StyleSpecification } from "maplibre-gl";

export type TileLayerOption = {
  id: string;
  name: string;
  style: string | StyleSpecification;
  attribution: string;
};

export const TILE_LAYERS: TileLayerOption[] = [
  {
    id: "dark",
    name: "Dark",
    style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    id: "light",
    name: "Light",
    style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    id: "street",
    name: "Street Map",
    style: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    id: "satellite",
    name: "Satellite",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    style: {
      version: 8,
      sources: {
        "esri-satellite": {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          attribution:
            "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        },
      },
      layers: [
        {
          id: "esri-satellite-layer",
          type: "raster",
          source: "esri-satellite",
        },
      ],
    },
  },
];
