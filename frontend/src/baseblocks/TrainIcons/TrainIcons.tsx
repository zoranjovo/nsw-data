import type maplibregl from "maplibre-gl";
import type { ExpressionSpecification } from "maplibre-gl";
import { useCallback, useEffect, useRef } from "react";
import { getTrainTimetableBulk } from "@/client-api/train";
import {
  buildTrainMotion,
  sampleTrainMotion,
  type TrainMotion,
} from "@/lib/trainPositionInterpolator";
import { useAppContext } from "@/providers/AppProvider";
import { isTimetableData, type TimetableData } from "@/types/train/timetable";
import type { TrainTracksResponse } from "@/types/train/tracks";
import type { TrainPosition } from "@/types/train/train";
import { isMapRemoved, useMapLibre } from "../MapView/MapContext";
import { syncTrainOverlayLayerOrder, TRAIN_POSITIONS_LAYER_ID } from "../trainMapLayers";

const SOURCE_ID = "train-positions";
const LAYER_ID = TRAIN_POSITIONS_LAYER_ID;
const ICON_ID = "train-arrow";
const DOT_ICON_ID = "train-dot";

const SELECTED_ICON_ID = "train-arrow-selected";
const SELECTED_DOT_ICON_ID = "train-dot-selected";

const STALE_POSITION_SECONDS = 10 * 60;
const TIMETABLE_PREFETCH_DEBOUNCE_MS = 200;

const MIN_UPDATE_INTERVAL_MS = 1000 / 30;
const MAX_UPDATE_INTERVAL_MS = 1000;
const STEPPED_UPDATE_INTERVAL_MS = 1000;
/** Meters per pixel at zoom 0 for MapLibre's 512px tile scheme. */
const METERS_PER_PIXEL_AT_ZOOM_0 = 78_271.516;
const TARGET_PIXEL_STEP = 0.5;
const ASSUMED_TRAIN_SPEED_MPS = 30;
const VIEWPORT_PADDING_RATIO = 0.25;

const ICON_IMAGE = [
  "case",
  ["==", ["get", "hasBearing"], false],
  ["case", ["==", ["get", "isSelected"], true], SELECTED_DOT_ICON_ID, DOT_ICON_ID],
  ["case", ["==", ["get", "isSelected"], true], SELECTED_ICON_ID, ICON_ID],
] as ExpressionSpecification;
const ICON_ROTATE = ["coalesce", ["get", "bearing"], 0] as ExpressionSpecification;

const ICON_SIZE_STOPS = [
  "interpolate",
  ["linear"],
  ["zoom"],
  8,
  0.3,
  11,
  0.6,
  14,
  0.95,
  17,
  1.4,
] as ExpressionSpecification;

const isSameTrain = (position: TrainPosition, selectedTrain: TrainPosition | null): boolean =>
  selectedTrain != null &&
  ((selectedTrain.tripId.length > 0 && position.tripId === selectedTrain.tripId) ||
    (selectedTrain.vehicleId.length > 0 && position.vehicleId === selectedTrain.vehicleId));

const trainKey = (position: TrainPosition): string =>
  position.tripId.length > 0 ? `t:${position.tripId}` : `v:${position.vehicleId}`;

const motionStamp = (position: TrainPosition): string =>
  `${position.timestamp ?? ""}|${position.latitude}|${position.longitude}`;

const uniqueTripIds = (tripIds: string[]): string[] => [
  ...new Set(tripIds.filter((tripId) => tripId.trim().length > 0)),
];

type ArrowShapeOptions = {
  shadowColor: string;
  borderColor: string;
  borderWidth: number;
  /** Extra glow strokes drawn under the drop shadow (selected-state only). */
  glowLayers?: [string, number][];
};

const drawArrowShape = (
  ctx: CanvasRenderingContext2D,
  size: number,
  options: ArrowShapeOptions
): void => {
  const cx = size / 2;
  const pad = size * 0.1;
  const notchY = size * 0.59;

  const traceArrow = () => {
    ctx.beginPath();
    ctx.moveTo(cx, pad);
    ctx.lineTo(size - pad, size - pad);
    ctx.lineTo(cx, notchY);
    ctx.lineTo(pad, size - pad);
    ctx.closePath();
  };

  ctx.clearRect(0, 0, size, size);

  if (options.glowLayers) {
    for (const [color, lineWidth] of options.glowLayers) {
      traceArrow();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }

  ctx.save();
  ctx.translate(size * 0.04, size * 0.06);
  ctx.fillStyle = options.shadowColor;
  traceArrow();
  ctx.fill();
  ctx.restore();

  ctx.save();
  traceArrow();
  ctx.clip();
  const bodyGrad = ctx.createLinearGradient(cx, pad, cx, size - pad);
  bodyGrad.addColorStop(0, "rgb(218, 228, 100)");
  bodyGrad.addColorStop(0.4, "rgb(196, 210, 45)");
  bodyGrad.addColorStop(1, "rgb(118, 128, 28)");
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(cx, pad);
  ctx.lineTo(size - pad, size - pad);
  ctx.lineTo(cx, notchY);
  ctx.closePath();
  ctx.fillStyle = "rgba(72, 78, 16, 0.42)";
  ctx.fill();

  traceArrow();
  ctx.strokeStyle = options.borderColor;
  ctx.lineWidth = options.borderWidth;
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx * 0.92, pad + size * 0.08);
  ctx.lineTo(pad + size * 0.06, size - pad - size * 0.08);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = Math.max(0.5, size * 0.016);
  ctx.stroke();
};

const createArrowImage = (size: number): ImageData => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable");
  }

  drawArrowShape(ctx, size, {
    shadowColor: "rgba(0,0,0,0.22)",
    borderColor: "rgba(255,255,255,0.95)",
    borderWidth: Math.max(1, size * 0.03),
  });

  return ctx.getImageData(0, 0, size, size);
};

const createSelectedArrowImage = (size: number): ImageData => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  drawArrowShape(ctx, size, {
    shadowColor: "rgba(0,0,0,0.3)",
    borderColor: "rgba(255,255,255,1)",
    borderWidth: Math.max(2, size * 0.065),
    glowLayers: [
      ["rgba(56, 189, 248, 0.18)", size * 0.18],
      ["rgba(56, 189, 248, 0.32)", size * 0.12],
      ["rgba(56, 189, 248, 0.55)", size * 0.07],
    ],
  });

  return ctx.getImageData(0, 0, size, size);
};

type DotShapeOptions = {
  shadowColor: string;
  borderColor: string;
  borderWidth: number;
  /** Extra glow strokes drawn under the drop shadow (selected-state only). */
  glowLayers?: [string, number][];
};

const drawDotShape = (
  ctx: CanvasRenderingContext2D,
  size: number,
  options: DotShapeOptions
): void => {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.3;

  const traceDot = () => {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();
  };

  ctx.clearRect(0, 0, size, size);

  if (options.glowLayers) {
    for (const [color, lineWidth] of options.glowLayers) {
      traceDot();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  ctx.save();
  ctx.translate(size * 0.04, size * 0.06);
  ctx.fillStyle = options.shadowColor;
  traceDot();
  ctx.fill();
  ctx.restore();

  ctx.save();
  traceDot();
  ctx.clip();
  const bodyGrad = ctx.createLinearGradient(cx, cy - radius, cx, cy + radius);
  bodyGrad.addColorStop(0, "rgb(218, 228, 100)");
  bodyGrad.addColorStop(0.4, "rgb(196, 210, 45)");
  bodyGrad.addColorStop(1, "rgb(118, 128, 28)");
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  traceDot();
  ctx.strokeStyle = options.borderColor;
  ctx.lineWidth = options.borderWidth;
  ctx.stroke();
};

const createDotImage = (size: number): ImageData => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable");
  }

  drawDotShape(ctx, size, {
    shadowColor: "rgba(0,0,0,0.22)",
    borderColor: "rgba(255,255,255,0.95)",
    borderWidth: Math.max(1, size * 0.03),
  });

  return ctx.getImageData(0, 0, size, size);
};

const createSelectedDotImage = (size: number): ImageData => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  drawDotShape(ctx, size, {
    shadowColor: "rgba(0,0,0,0.3)",
    borderColor: "rgba(255,255,255,1)",
    borderWidth: Math.max(2, size * 0.065),
    glowLayers: [
      ["rgba(56, 189, 248, 0.18)", size * 0.18],
      ["rgba(56, 189, 248, 0.32)", size * 0.12],
      ["rgba(56, 189, 248, 0.55)", size * 0.07],
    ],
  });

  return ctx.getImageData(0, 0, size, size);
};

const EMPTY_GEOJSON: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

type MotionCacheEntry = {
  timetable: TimetableData;
  tracks: TrainTracksResponse;
  stamp: string;
  motion: TrainMotion | null;
};

export const TrainIcons = () => {
  const map = useMapLibre();
  const {
    setSelectedItem,
    selectedItem,
    interpolatedTrainMovement,
    smoothInterpolatedTrainMovement,
    trainRealtime,
    trainStatic,
    cacheTimetables,
  } = useAppContext();

  const positionsRef = useRef<TrainPosition[]>([]);
  const timetablesByTripIdRef = useRef<Map<string, TimetableData>>(new Map());
  const tracksRef = useRef<TrainTracksResponse>(trainStatic.tracks);
  const motionCacheRef = useRef<Map<string, MotionCacheEntry>>(new Map());
  const selectedItemRef = useRef(selectedItem);
  const interpolatedRef = useRef(interpolatedTrainMovement);
  const cachedTimetableTripIdsRef = useRef<Set<string>>(new Set());
  const failedPrefetchTripIdsRef = useRef<Set<string>>(new Set());
  const inFlightTimetableTripIdsRef = useRef<Set<string>>(new Set());
  const schedulePrefetchRef = useRef<(() => void) | null>(null);

  const fetchAndCacheTimetables = useCallback(
    async (tripIds: string[], options?: { force?: boolean }) => {
      const force = options?.force ?? false;
      const missingTripIds = uniqueTripIds(tripIds).filter((tripId) => {
        if (cachedTimetableTripIdsRef.current.has(tripId)) return false;
        if (inFlightTimetableTripIdsRef.current.has(tripId)) return false;
        return force || !failedPrefetchTripIdsRef.current.has(tripId);
      });
      if (missingTripIds.length === 0) return;

      for (const tripId of missingTripIds) {
        inFlightTimetableTripIdsRef.current.add(tripId);
      }

      try {
        const data = await getTrainTimetableBulk(missingTripIds);
        const timetables = data.filter(isTimetableData);
        cacheTimetables(timetables);
        for (const timetable of timetables) {
          failedPrefetchTripIdsRef.current.delete(timetable.tripId);
        }
      } catch {
        if (!force) {
          for (const tripId of missingTripIds) {
            failedPrefetchTripIdsRef.current.add(tripId);
          }
        }
      } finally {
        for (const tripId of missingTripIds) {
          inFlightTimetableTripIdsRef.current.delete(tripId);
        }
      }
    },
    [cacheTimetables]
  );

  const getSelectedTrain = useCallback((): TrainPosition | null => {
    const selected = selectedItemRef.current;
    return selected?.type === "train" ? (selected.data as TrainPosition) : null;
  }, []);

  const getTrainMotion = useCallback((position: TrainPosition): TrainMotion | null => {
    const timetable = timetablesByTripIdRef.current.get(position.tripId);
    if (!timetable) return null;

    const tracks = tracksRef.current;
    const key = trainKey(position);
    const stamp = motionStamp(position);
    const cached = motionCacheRef.current.get(key);
    if (
      cached != null &&
      cached.timetable === timetable &&
      cached.tracks === tracks &&
      cached.stamp === stamp
    ) {
      return cached.motion;
    }

    const motion = buildTrainMotion(
      timetable,
      position,
      tracks,
      position.routeId || timetable.routeId
    );
    motionCacheRef.current.set(key, { timetable, tracks, stamp, motion });
    return motion;
  }, []);

  const syncPositionsData = useCallback(() => {
    if (!map) return;
    if (isMapRemoved(map)) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    const nowEpochSeconds = Date.now() / 1000;
    const selectedTrain = getSelectedTrain();
    const interpolate = interpolatedRef.current;

    const bounds = map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const north = bounds.getNorth();
    const padX = (east - west) * VIEWPORT_PADDING_RATIO;
    const padY = (north - south) * VIEWPORT_PADDING_RATIO;
    const minLng = west - padX;
    const maxLng = east + padX;
    const minLat = south - padY;
    const maxLat = north + padY;

    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
    for (const position of positionsRef.current) {
      let longitude = position.longitude;
      let latitude = position.latitude;
      let bearing = position.bearing ?? null;

      if (interpolate) {
        const motion = getTrainMotion(position);
        const sample = motion != null ? sampleTrainMotion(motion, nowEpochSeconds) : null;
        if (sample != null) {
          longitude = sample.longitude;
          latitude = sample.latitude;
          bearing = sample.bearing;
        } else {
          bearing = null;
        }
      }

      const isSelected = isSameTrain(position, selectedTrain);
      if (
        !isSelected &&
        (longitude < minLng || longitude > maxLng || latitude < minLat || latitude > maxLat)
      ) {
        continue;
      }

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [longitude, latitude] },
        properties: {
          routeId: position.routeId,
          vehicleId: position.vehicleId,
          vehicleLabel: position.vehicleLabel,
          tripId: position.tripId,
          speed: position.speed,
          timestamp: position.timestamp,
          bearing,
          hasBearing: bearing != null,
          isSelected,
          isStale:
            position.timestamp != null
              ? nowEpochSeconds - position.timestamp > STALE_POSITION_SECONDS
              : false,
        },
      });
    }

    source.setData({ type: "FeatureCollection", features });
  }, [map, getSelectedTrain, getTrainMotion]);

  useEffect(() => {
    const byTripId = new Map<string, TimetableData>();
    for (const timetable of trainStatic.timetables) {
      byTripId.set(timetable.tripId, timetable);
    }
    timetablesByTripIdRef.current = byTripId;
    cachedTimetableTripIdsRef.current = new Set(byTripId.keys());
    syncPositionsData();
  }, [trainStatic.timetables, syncPositionsData]);

  useEffect(() => {
    tracksRef.current = trainStatic.tracks;
    syncPositionsData();
  }, [trainStatic.tracks, syncPositionsData]);

  useEffect(() => {
    interpolatedRef.current = interpolatedTrainMovement;
    syncPositionsData();
  }, [interpolatedTrainMovement, syncPositionsData]);

  useEffect(() => {
    selectedItemRef.current = selectedItem;
    syncPositionsData();
  }, [selectedItem, syncPositionsData]);

  useEffect(() => {
    if (!map) return;

    const registerIcon = () => {
      if (isMapRemoved(map)) return;
      if (!map.hasImage(ICON_ID)) {
        map.addImage(ICON_ID, createArrowImage(48), { sdf: false });
      }
      if (!map.hasImage(SELECTED_ICON_ID)) {
        map.addImage(SELECTED_ICON_ID, createSelectedArrowImage(48), { sdf: false });
      }
      if (!map.hasImage(DOT_ICON_ID)) {
        map.addImage(DOT_ICON_ID, createDotImage(48), { sdf: false });
      }
      if (!map.hasImage(SELECTED_DOT_ICON_ID)) {
        map.addImage(SELECTED_DOT_ICON_ID, createSelectedDotImage(48), { sdf: false });
      }
    };

    const addTrainPositionsLayer = () => {
      if (isMapRemoved(map)) return;
      registerIcon();
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: "geojson", data: EMPTY_GEOJSON });
        map.addLayer({
          id: LAYER_ID,
          type: "symbol",
          source: SOURCE_ID,
          layout: {
            "icon-image": ICON_IMAGE,
            "icon-size": ICON_SIZE_STOPS,
            "icon-rotate": ICON_ROTATE,
            "icon-rotation-alignment": "map",
            "icon-pitch-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: {
            "icon-opacity": [
              "case",
              ["==", ["get", "isStale"], true],
              0.4,
              1,
            ] as ExpressionSpecification,
          },
        });
      }
      syncTrainOverlayLayerOrder(map);
      syncPositionsData();
    };
    addTrainPositionsLayer();

    const onMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onMouseLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    const onClick = async (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_ID] });
      if (features.length === 0) return;
      const feature = features[0];
      const props = feature.properties ?? {};
      const coords = (feature.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
      const vehicleId = String(props.vehicleId ?? "");
      const tripId = String(props.tripId ?? "");
      const fromData =
        positionsRef.current.find((position) => position.tripId === tripId) ??
        positionsRef.current.find((position) => position.vehicleId === vehicleId);
      const selectedTrain: TrainPosition = fromData ?? {
        tripId,
        routeId: String(props.routeId ?? ""),
        vehicleId,
        vehicleLabel: String(props.vehicleLabel ?? vehicleId),
        latitude: coords[1],
        longitude: coords[0],
        timestamp: props.timestamp != null ? Number(props.timestamp) : null,
        bearing: props.bearing != null ? Number(props.bearing) : null,
        speed: props.speed != null ? Number(props.speed) : null,
      };
      if (interpolatedRef.current && tripId && !cachedTimetableTripIdsRef.current.has(tripId)) {
        await fetchAndCacheTimetables([tripId], { force: true });
      }
      setSelectedItem({ type: "train", data: selectedTrain });
    };

    map.on("style.load", addTrainPositionsLayer);
    map.on("moveend", syncPositionsData);
    map.on("mouseenter", LAYER_ID, onMouseEnter);
    map.on("mouseleave", LAYER_ID, onMouseLeave);
    map.on("click", LAYER_ID, onClick);

    return () => {
      if (isMapRemoved(map)) return;
      map.off("style.load", addTrainPositionsLayer);
      map.off("moveend", syncPositionsData);
      map.off("mouseenter", LAYER_ID, onMouseEnter);
      map.off("mouseleave", LAYER_ID, onMouseLeave);
      map.off("click", LAYER_ID, onClick);
      if (map.getSource(SOURCE_ID)) {
        map.removeLayer(LAYER_ID);
        map.removeSource(SOURCE_ID);
      }
    };
  }, [map, setSelectedItem, fetchAndCacheTimetables, syncPositionsData]);

  useEffect(() => {
    positionsRef.current = trainRealtime.positions.items;

    const liveKeys = new Set(trainRealtime.positions.items.map(trainKey));
    for (const key of motionCacheRef.current.keys()) {
      if (!liveKeys.has(key)) {
        motionCacheRef.current.delete(key);
      }
    }

    syncPositionsData();
    schedulePrefetchRef.current?.();
  }, [trainRealtime.positions, syncPositionsData]);

  useEffect(() => {
    if (!map) return;
    if (isMapRemoved(map)) return;
    if (!interpolatedTrainMovement) return;

    // Trains move a fraction of a pixel per second when zoomed out, so redraw far less often there
    const updateIntervalMs = (): number => {
      if (!smoothInterpolatedTrainMovement) return STEPPED_UPDATE_INTERVAL_MS;
      const latitudeRadians = (map.getCenter().lat * Math.PI) / 180;
      const metersPerPixel =
        (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos(latitudeRadians)) / 2 ** map.getZoom();
      const intervalMs = (TARGET_PIXEL_STEP * metersPerPixel * 1000) / ASSUMED_TRAIN_SPEED_MPS;
      return Math.min(MAX_UPDATE_INTERVAL_MS, Math.max(MIN_UPDATE_INTERVAL_MS, intervalMs));
    };

    let frameId: number | null = null;
    let lastUpdateMs = 0;
    const animate = (frameMs: number) => {
      frameId = window.requestAnimationFrame(animate);
      if (isMapRemoved(map)) return;
      // Pushing geometry mid-gesture just competes with the pan/zoom the user is doing
      if (map.isMoving()) return;
      if (frameMs - lastUpdateMs < updateIntervalMs()) return;
      lastUpdateMs = frameMs;
      syncPositionsData();
    };

    syncPositionsData();
    frameId = window.requestAnimationFrame(animate);

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [map, interpolatedTrainMovement, smoothInterpolatedTrainMovement, syncPositionsData]);

  useEffect(() => {
    if (!map) return;
    if (isMapRemoved(map)) return;
    if (!interpolatedTrainMovement) {
      schedulePrefetchRef.current = null;
      return;
    }

    let timeoutId: number | null = null;
    const prefetchVisibleTimetables = () => {
      if (isMapRemoved(map)) return;
      const bounds = map.getBounds();
      void fetchAndCacheTimetables(
        uniqueTripIds(
          positionsRef.current
            .filter((position) => bounds.contains([position.longitude, position.latitude]))
            .map((position) => position.tripId)
        )
      );
    };
    const schedulePrefetch = () => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(prefetchVisibleTimetables, TIMETABLE_PREFETCH_DEBOUNCE_MS);
    };

    schedulePrefetchRef.current = schedulePrefetch;
    schedulePrefetch();
    map.on("moveend", schedulePrefetch);

    return () => {
      schedulePrefetchRef.current = null;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      if (!isMapRemoved(map)) {
        map.off("moveend", schedulePrefetch);
      }
    };
  }, [map, interpolatedTrainMovement, fetchAndCacheTimetables]);

  return null;
};
