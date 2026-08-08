import type {
  HillshadeLayerSpecification,
  RasterDEMSourceSpecification,
  SkySpecification,
} from "maplibre-gl";

export const TERRAIN_SOURCE_ID = "terrain-dem";
export const HILLSHADE_LAYER_ID = "terrain-hillshade";

const TERRAIN_BOUNDS: [number, number, number, number] = [140.9, -37.65, 153.75, -28.0];

const TILES_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

const MAX_ZOOM = 12;

export const TERRAIN_MAX_PITCH = 75;
export const FLAT_MAX_PITCH = 60;

export const TERRAIN_SOURCE: RasterDEMSourceSpecification = {
  type: "raster-dem",
  tiles: [TILES_URL],
  tileSize: 256,
  minzoom: 0,
  maxzoom: MAX_ZOOM,
  bounds: TERRAIN_BOUNDS,
  encoding: "terrarium",
  attribution:
    'Elevation: SRTM and GMTED2010 courtesy of the <a href="https://www.usgs.gov/">U.S. Geological Survey</a>, ETOPO1 courtesy of <a href="https://www.noaa.gov/">NOAA</a>, via <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Tilezen Joerd</a>',
};

type TerrainTheme = {
  sky: SkySpecification;
  hillshade: HillshadeLayerSpecification["paint"] | null;
};

const FOG_GROUND_BLEND: SkySpecification["fog-ground-blend"] = [
  "interpolate",
  ["linear"],
  ["zoom"],
  7,
  0.6,
  12,
  0.85,
  15,
  0.95,
];

const ATMOSPHERE_BLEND: SkySpecification["atmosphere-blend"] = [
  "interpolate",
  ["linear"],
  ["zoom"],
  7,
  0.8,
  12,
  0.4,
  15,
  0,
];

const TERRAIN_THEMES: Record<string, TerrainTheme> = {
  dark: {
    sky: {
      "sky-color": "#05070d",
      "horizon-color": "#243044",
      "fog-color": "#0d1117",
      "fog-ground-blend": FOG_GROUND_BLEND,
      "horizon-fog-blend": 0.5,
      "sky-horizon-blend": 0.8,
      "atmosphere-blend": ATMOSPHERE_BLEND,
    },
    hillshade: {
      "hillshade-exaggeration": 0.35,
      "hillshade-shadow-color": "#000000",
      "hillshade-highlight-color": "#4b5563",
      "hillshade-accent-color": "#0b1220",
      "hillshade-method": "igor",
    },
  },
  light: {
    sky: {
      "sky-color": "#8fc4f5",
      "horizon-color": "#dfeaf6",
      "fog-color": "#eef2f7",
      "fog-ground-blend": FOG_GROUND_BLEND,
      "horizon-fog-blend": 0.6,
      "sky-horizon-blend": 0.8,
      "atmosphere-blend": ATMOSPHERE_BLEND,
    },
    hillshade: {
      "hillshade-exaggeration": 0.25,
      "hillshade-shadow-color": "#5b6472",
      "hillshade-highlight-color": "#ffffff",
      "hillshade-accent-color": "#c9ced8",
      "hillshade-method": "igor",
    },
  },
  street: {
    sky: {
      "sky-color": "#9ec9f0",
      "horizon-color": "#e6eef7",
      "fog-color": "#eef2f7",
      "fog-ground-blend": FOG_GROUND_BLEND,
      "horizon-fog-blend": 0.6,
      "sky-horizon-blend": 0.8,
      "atmosphere-blend": ATMOSPHERE_BLEND,
    },
    hillshade: {
      "hillshade-exaggeration": 0.22,
      "hillshade-shadow-color": "#6b7280",
      "hillshade-highlight-color": "#ffffff",
      "hillshade-accent-color": "#cbd2dc",
      "hillshade-method": "igor",
    },
  },
  satellite: {
    sky: {
      "sky-color": "#0f2b4d",
      "horizon-color": "#a9c7e8",
      "fog-color": "#33465c",
      "fog-ground-blend": FOG_GROUND_BLEND,
      "horizon-fog-blend": 0.5,
      "sky-horizon-blend": 0.8,
      "atmosphere-blend": ATMOSPHERE_BLEND,
    },
    hillshade: null,
  },
};

export const getTerrainTheme = (layerId: string): TerrainTheme =>
  TERRAIN_THEMES[layerId] ?? TERRAIN_THEMES.dark;
