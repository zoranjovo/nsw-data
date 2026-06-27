import type maplibregl from "maplibre-gl";
import type { ExpressionSpecification } from "maplibre-gl";
import { useCallback, useEffect, useRef } from "react";
import { getTrainTimetableBulk } from "@/client-api/train";
import { buildAnimationWaypoints, interpolatePosition } from "@/lib/trainPositionInterpolator";
import { useAppContext } from "@/providers/AppProvider";
import type { TimetableData } from "@/types/train/timetable";
import type { TrainPosition } from "@/types/train/train";
import { useMapLibre } from "../MapView/MapContext";
import { syncTrainOverlayLayerOrder, TRAIN_POSITIONS_LAYER_ID } from "../trainMapLayers";

const SOURCE_ID = "train-positions";
const LAYER_ID = TRAIN_POSITIONS_LAYER_ID;
const ICON_ID = "train-arrow";

const SELECTED_ICON_ID = "train-arrow-selected";

const STALE_POSITION_SECONDS = 10 * 60;
const TIMETABLE_PREFETCH_DEBOUNCE_MS = 200;
const ANIMATION_FRAME_MIN_MS = 1000 / 30;
const ICON_IMAGE = [
  "case",
  ["==", ["get", "isSelected"], true],
  SELECTED_ICON_ID,
  ICON_ID,
] as ExpressionSpecification;
const ICON_ROTATE = ["coalesce", ["get", "bearing"], 0] as ExpressionSpecification;

const isSameTrain = (position: TrainPosition, selectedTrain: TrainPosition | null): boolean =>
  selectedTrain != null &&
  ((selectedTrain.tripId.length > 0 && position.tripId === selectedTrain.tripId) ||
    (selectedTrain.vehicleId.length > 0 && position.vehicleId === selectedTrain.vehicleId));

const positionsToGeoJSON = (
  positions: TrainPosition[],
  nowEpochSeconds: number,
  selectedTrain: TrainPosition | null
): GeoJSON.FeatureCollection => {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = positions.map((p) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
    properties: {
      routeId: p.routeId,
      vehicleId: p.vehicleId,
      vehicleLabel: p.vehicleLabel,
      tripId: p.tripId,
      speed: p.speed,
      timestamp: p.timestamp,
      bearing: p.bearing ?? null,
      isSelected: isSameTrain(p, selectedTrain),
      isStale: p.timestamp != null ? nowEpochSeconds - p.timestamp > STALE_POSITION_SECONDS : false,
    },
  }));
  return { type: "FeatureCollection", features };
};

const isTimetableData = (value: unknown): value is TimetableData => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TimetableData>;
  return typeof candidate.tripId === "string" && Array.isArray(candidate.stops);
};

const uniqueTripIds = (tripIds: string[]): string[] => [
  ...new Set(tripIds.filter((tripId) => tripId.trim().length > 0)),
];

const createArrowImage = (size: number): ImageData => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable");
  }
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

  ctx.save();
  ctx.translate(size * 0.04, size * 0.06);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
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
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx * 0.92, pad + size * 0.08);
  ctx.lineTo(pad + size * 0.06, size - pad - size * 0.08);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = Math.max(0.5, size * 0.016);
  ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
};

const createSelectedArrowImage = (size: number): ImageData => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

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

  const glowLayers: [string, number][] = [
    ["rgba(56, 189, 248, 0.18)", size * 0.18],
    ["rgba(56, 189, 248, 0.32)", size * 0.12],
    ["rgba(56, 189, 248, 0.55)", size * 0.07],
  ];
  for (const [color, lineWidth] of glowLayers) {
    traceArrow();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  // Drop shadow
  ctx.save();
  ctx.translate(size * 0.04, size * 0.06);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  traceArrow();
  ctx.fill();
  ctx.restore();

  // Body fil
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

  // Dark overlay on the forward half
  ctx.beginPath();
  ctx.moveTo(cx, pad);
  ctx.lineTo(size - pad, size - pad);
  ctx.lineTo(cx, notchY);
  ctx.closePath();
  ctx.fillStyle = "rgba(72, 78, 16, 0.42)";
  ctx.fill();

  // Thick bright-white border
  traceArrow();
  ctx.strokeStyle = "rgba(255,255,255,1)";
  ctx.lineWidth = Math.max(2, size * 0.065);
  ctx.lineJoin = "round";
  ctx.stroke();

  // Highlight sheen
  ctx.beginPath();
  ctx.moveTo(cx * 0.92, pad + size * 0.08);
  ctx.lineTo(pad + size * 0.06, size - pad - size * 0.08);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = Math.max(0.5, size * 0.016);
  ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
};

const EMPTY_GEOJSON: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

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
  const selectedItemRef = useRef(selectedItem);
  const cachedTimetableTripIdsRef = useRef<Set<string>>(new Set());
  const failedPrefetchTripIdsRef = useRef<Set<string>>(new Set());
  const inFlightTimetableTripIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    cachedTimetableTripIdsRef.current = new Set(
      trainStatic.timetables.map((timetable) => timetable.tripId)
    );
  }, [trainStatic.timetables]);

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

  const getVisibleTrainTripIds = useCallback(() => {
    if (!map) return [];
    const bounds = map.getBounds();
    return uniqueTripIds(
      trainRealtime.positions.items
        .filter((position) => bounds.contains([position.longitude, position.latitude]))
        .map((position) => position.tripId)
    );
  }, [map, trainRealtime.positions.items]);

  const getDisplayTrainPosition = useCallback(
    (position: TrainPosition, nowEpochSeconds: number): TrainPosition => {
      if (!interpolatedTrainMovement) {
        return position;
      }

      const timetable = trainStatic.timetables.find(
        (candidate) => candidate.tripId === position.tripId
      );
      if (!timetable) {
        return position;
      }

      const interpolated = interpolatePosition(
        buildAnimationWaypoints(timetable, position),
        nowEpochSeconds,
        trainStatic.tracks,
        position.routeId || timetable.routeId
      );
      if (!interpolated) {
        return position;
      }

      return {
        ...position,
        latitude: interpolated.latitude,
        longitude: interpolated.longitude,
        bearing: interpolated.bearing,
      };
    },
    [interpolatedTrainMovement, trainStatic.timetables, trainStatic.tracks]
  );

  const getDisplayTrainPositions = useCallback(
    (positions: TrainPosition[], nowEpochSeconds: number): TrainPosition[] =>
      positions.map((position) => getDisplayTrainPosition(position, nowEpochSeconds)),
    [getDisplayTrainPosition]
  );

  const getSelectedTrain = useCallback((): TrainPosition | null => {
    const selected = selectedItemRef.current;
    return selected?.type === "train" ? (selected.data as TrainPosition) : null;
  }, []);

  useEffect(() => {
    if (!map) return;
    const isMapRemoved = () => Boolean((map as { _removed?: boolean })._removed);

    const registerIcon = () => {
      if (isMapRemoved()) return;
      if (!map.hasImage(ICON_ID)) {
        map.addImage(ICON_ID, createArrowImage(48), { sdf: false });
      }
      if (!map.hasImage(SELECTED_ICON_ID)) {
        map.addImage(SELECTED_ICON_ID, createSelectedArrowImage(48), { sdf: false });
      }
    };

    const syncPositionsData = () => {
      const geoSource = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!geoSource) return;
      const nowEpochSeconds = Date.now() / 1000;
      geoSource.setData(
        positionsToGeoJSON(
          getDisplayTrainPositions(positionsRef.current, nowEpochSeconds),
          nowEpochSeconds,
          getSelectedTrain()
        )
      );
    };

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

    const addTrainPositionsLayer = () => {
      if (isMapRemoved()) return;
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
      if (interpolatedTrainMovement && tripId && !cachedTimetableTripIdsRef.current.has(tripId)) {
        await fetchAndCacheTimetables([tripId], { force: true });
      }
      setSelectedItem({ type: "train", data: selectedTrain });
    };

    map.on("style.load", addTrainPositionsLayer);
    map.on("mouseenter", LAYER_ID, onMouseEnter);
    map.on("mouseleave", LAYER_ID, onMouseLeave);
    map.on("click", LAYER_ID, onClick);

    return () => {
      if (isMapRemoved()) return;
      map.off("style.load", addTrainPositionsLayer);
      map.off("mouseenter", LAYER_ID, onMouseEnter);
      map.off("mouseleave", LAYER_ID, onMouseLeave);
      map.off("click", LAYER_ID, onClick);
      if (map.getSource(SOURCE_ID)) {
        map.removeLayer(LAYER_ID);
        map.removeSource(SOURCE_ID);
      }
    };
  }, [
    map,
    setSelectedItem,
    interpolatedTrainMovement,
    fetchAndCacheTimetables,
    getDisplayTrainPositions,
    getSelectedTrain,
  ]);

  useEffect(() => {
    if (!map) return;
    const isMapRemoved = () => Boolean((map as { _removed?: boolean })._removed);
    if (isMapRemoved()) return;

    const positions = trainRealtime.positions;
    positionsRef.current = positions.items;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      const nowEpochSeconds = Date.now() / 1000;
      source.setData(
        positionsToGeoJSON(
          getDisplayTrainPositions(positions.items, nowEpochSeconds),
          nowEpochSeconds,
          getSelectedTrain()
        )
      );
      syncTrainOverlayLayerOrder(map);
    }
  }, [map, trainRealtime.positions, getDisplayTrainPositions, getSelectedTrain]);

  useEffect(() => {
    if (!map) return;
    const isMapRemoved = () => Boolean((map as { _removed?: boolean })._removed);
    if (isMapRemoved()) return;
    if (!interpolatedTrainMovement) return;

    const updateDisplayPositions = () => {
      if (isMapRemoved()) return;
      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      const nowEpochSeconds = Date.now() / 1000;
      source.setData(
        positionsToGeoJSON(
          getDisplayTrainPositions(trainRealtime.positions.items, nowEpochSeconds),
          nowEpochSeconds,
          getSelectedTrain()
        )
      );
    };

    updateDisplayPositions();
    if (!smoothInterpolatedTrainMovement) {
      const intervalId = window.setInterval(updateDisplayPositions, 1000);
      return () => {
        window.clearInterval(intervalId);
      };
    }

    let frameId: number | null = null;
    let lastFrameMs = 0;
    const animate = (frameMs: number) => {
      if (lastFrameMs === 0 || frameMs - lastFrameMs >= ANIMATION_FRAME_MIN_MS) {
        lastFrameMs = frameMs;
        updateDisplayPositions();
      }
      frameId = window.requestAnimationFrame(animate);
    };
    frameId = window.requestAnimationFrame(animate);

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [
    map,
    interpolatedTrainMovement,
    smoothInterpolatedTrainMovement,
    trainRealtime.positions.items,
    getDisplayTrainPositions,
    getSelectedTrain,
  ]);

  useEffect(() => {
    if (!map) return;
    const isMapRemoved = () => Boolean((map as { _removed?: boolean })._removed);
    if (isMapRemoved()) return;
    if (!interpolatedTrainMovement) return;

    let timeoutId: number | null = null;
    const prefetchVisibleTimetables = () => {
      if (isMapRemoved()) return;
      void fetchAndCacheTimetables(getVisibleTrainTripIds());
    };
    const schedulePrefetch = () => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(prefetchVisibleTimetables, TIMETABLE_PREFETCH_DEBOUNCE_MS);
    };

    schedulePrefetch();
    map.on("moveend", schedulePrefetch);

    return () => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      if (!isMapRemoved()) {
        map.off("moveend", schedulePrefetch);
      }
    };
  }, [map, interpolatedTrainMovement, fetchAndCacheTimetables, getVisibleTrainTripIds]);

  useEffect(() => {
    selectedItemRef.current = selectedItem;
    if (!map) return;
    const isMapRemoved = () => Boolean((map as { _removed?: boolean })._removed);
    if (isMapRemoved()) return;

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    const nowEpochSeconds = Date.now() / 1000;
    source.setData(
      positionsToGeoJSON(
        getDisplayTrainPositions(positionsRef.current, nowEpochSeconds),
        nowEpochSeconds,
        getSelectedTrain()
      )
    );
  }, [map, selectedItem, getDisplayTrainPositions, getSelectedTrain]);

  return null;
};
