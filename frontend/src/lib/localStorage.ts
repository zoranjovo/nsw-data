export type MapStoredState = {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
  layerId: string;
  terrain3d: boolean;
};

const KEY = "map-state";
const DEFAULTS: MapStoredState = {
  center: [-33.8688, 151.2093],
  zoom: 10,
  bearing: 0,
  pitch: 0,
  layerId: "dark",
  terrain3d: false,
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
      pitch: typeof parsed.pitch === "number" ? parsed.pitch : DEFAULTS.pitch,
      layerId: typeof parsed.layerId === "string" ? parsed.layerId : DEFAULTS.layerId,
      terrain3d: typeof parsed.terrain3d === "boolean" ? parsed.terrain3d : DEFAULTS.terrain3d,
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
      pitch: patch.pitch ?? current.pitch,
      layerId: patch.layerId ?? current.layerId,
      terrain3d: patch.terrain3d ?? current.terrain3d,
    };
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
};

export type TrainMovementSettings = {
  interpolatedTrainMovement: boolean;
  smoothInterpolatedTrainMovement: boolean;
};

const TRAIN_MOVEMENT_KEY = "train-movement-settings";
const TRAIN_MOVEMENT_DEFAULTS: TrainMovementSettings = {
  interpolatedTrainMovement: true,
  smoothInterpolatedTrainMovement: false,
};

export const loadTrainMovementSettings = (): TrainMovementSettings => {
  try {
    const raw = window.localStorage.getItem(TRAIN_MOVEMENT_KEY);
    if (!raw) return TRAIN_MOVEMENT_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<TrainMovementSettings>;
    return {
      interpolatedTrainMovement:
        typeof parsed.interpolatedTrainMovement === "boolean"
          ? parsed.interpolatedTrainMovement
          : TRAIN_MOVEMENT_DEFAULTS.interpolatedTrainMovement,
      smoothInterpolatedTrainMovement:
        typeof parsed.smoothInterpolatedTrainMovement === "boolean"
          ? parsed.smoothInterpolatedTrainMovement
          : TRAIN_MOVEMENT_DEFAULTS.smoothInterpolatedTrainMovement,
    };
  } catch {
    return TRAIN_MOVEMENT_DEFAULTS;
  }
};

export const saveTrainMovementSettings = (patch: Partial<TrainMovementSettings>): void => {
  try {
    const current = loadTrainMovementSettings();
    const next: TrainMovementSettings = {
      interpolatedTrainMovement:
        patch.interpolatedTrainMovement ?? current.interpolatedTrainMovement,
      smoothInterpolatedTrainMovement:
        patch.smoothInterpolatedTrainMovement ?? current.smoothInterpolatedTrainMovement,
    };
    window.localStorage.setItem(TRAIN_MOVEMENT_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
};
