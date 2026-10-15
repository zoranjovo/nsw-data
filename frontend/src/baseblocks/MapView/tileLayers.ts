import { addProtocol, type StyleSpecification } from "maplibre-gl";

const SATELLITE_PROTOCOL = "esri-satellite";
const ESRI_IMAGERY_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
// Esri answers tiles it has no imagery for with this exact grey "Map data not yet available" JPEG
const ESRI_PLACEHOLDER_BYTES = 2521;
const SATELLITE_MAX_TILE_ZOOM = 20;
export const NO_SATELLITE_IMAGERY = "No satellite imagery at this zoom";

let satelliteProtocolRegistered = false;

// Rejecting placeholders makes MapLibre keep showing the deepest real imagery, enlarged
export const registerSatelliteProtocol = (): void => {
  if (satelliteProtocolRegistered) return;
  satelliteProtocolRegistered = true;
  addProtocol(SATELLITE_PROTOCOL, async ({ url }, abortController) => {
    const tilePath = url.slice(`${SATELLITE_PROTOCOL}://`.length);
    const response = await fetch(`${ESRI_IMAGERY_URL}/${tilePath}`, {
      signal: abortController.signal,
    });
    if (!response.ok) throw new Error(`Satellite tile failed with ${response.status}`);
    const data = await response.arrayBuffer();
    if (data.byteLength === ESRI_PLACEHOLDER_BYTES) throw new Error(NO_SATELLITE_IMAGERY);
    return {
      data,
      cacheControl: response.headers.get("cache-control"),
      expires: response.headers.get("expires"),
    };
  });
};

export type TileLayerOption = {
  id: string;
  name: string;
  style: string | StyleSpecification;
  attribution: string;
  background: string;
};

export const TILE_LAYERS: TileLayerOption[] = [
  {
    id: "dark",
    name: "Dark",
    style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    background: "#0e0e0e",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    id: "light",
    name: "Light",
    style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    background: "#fafaf8",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    id: "street",
    name: "Street Map",
    style: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    background: "#fbf8f3",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    id: "satellite",
    name: "Satellite",
    background: "#000000",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    style: {
      version: 8,
      sources: {
        "esri-satellite": {
          type: "raster",
          tiles: [`${SATELLITE_PROTOCOL}://{z}/{y}/{x}`],
          tileSize: 256,
          maxzoom: SATELLITE_MAX_TILE_ZOOM,
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
