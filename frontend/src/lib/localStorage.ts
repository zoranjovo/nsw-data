export type MapStoredState = {
  center: [number, number];
  zoom: number;
  bearing: number;
  layerId: string;
};

const KEY = "map-state";
const DEFAULTS: MapStoredState = {
  center: [-33.8688, 151.2093],
  zoom: 10,
  bearing: 0,
  layerId: "dark",
};

export const loadMapState = (): MapStoredState => {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<MapStoredState>;
    return {
      center:
        Array.isArray(parsed.center) && parsed.center.length === 2
          ? [parsed.center[0] as number, parsed.center[1] as number]
          : DEFAULTS.center,
      zoom: typeof parsed.zoom === "number" ? parsed.zoom : DEFAULTS.zoom,
      bearing: typeof parsed.bearing === "number" ? parsed.bearing : DEFAULTS.bearing,
      layerId: typeof parsed.layerId === "string" ? parsed.layerId : DEFAULTS.layerId,
    };
  } catch {
    return DEFAULTS;
  }
};

export const saveMapState = (patch: Partial<MapStoredState>): void => {
  try {
    const current = loadMapState();
    const next: MapStoredState = {
      center: patch.center ?? current.center,
      zoom: patch.zoom ?? current.zoom,
      bearing: patch.bearing ?? current.bearing,
      layerId: patch.layerId ?? current.layerId,
    };
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
};
