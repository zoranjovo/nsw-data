import type maplibregl from "maplibre-gl";
import { useCallback, useEffect, useRef } from "react";
import { getTrainTimetableBulk } from "@/client-api/train";
import { isTimetableStale } from "@/lib/timetableRefresh";
import { describeTrainDestination } from "@/lib/trainDestination";
import { createTrainMotionCache } from "@/lib/trainMotionCache";
import { useAppContext, useLiveTrainData } from "@/providers/AppProvider";
import { isTimetableData, type TimetableData } from "@/types/train/timetable";
import type { TrainTracksResponse } from "@/types/train/tracks";
import type { TrainPosition } from "@/types/train/train";
import { isMapRemoved, useMapLibre } from "../MapView/MapContext";
import { getGeoJSONSource } from "../MapView/mapSources";
import { isWithinBounds, paddedVisibleBounds } from "../MapView/mapViewport";
import {
  syncTrainOverlayLayerOrder,
  TRAIN_MODELS_LAYER_ID,
  TRAIN_POSITIONS_LAYER_ID,
} from "../trainMapLayers";
import type { TrainModelInstance, TrainModelsLayer } from "./trainModelsLayer";
import { buildTrainPositionFeatures, trainPositionFeaturesKey } from "./trainPositionFeatures";
import {
  addTrainPositionsLayer,
  hideTrainIconsFromZoom,
  removeTrainPositionsLayer,
  TRAIN_POSITIONS_SOURCE_ID,
} from "./trainPositionsLayer";
import { trainUpdateIntervalMs } from "./trainUpdateRate";

const TIMETABLE_PREFETCH_DEBOUNCE_MS = 200;
const MISSING_TIMETABLE_RETRY_MS = 10 * 60 * 1000;
const FAILED_PREFETCH_RETRY_MS = 30 * 1000;
const VIEWPORT_PADDING_RATIO = 0.25;

const uniqueTripIds = (tripIds: string[]): string[] => [
  ...new Set(tripIds.filter((tripId) => tripId.trim().length > 0)),
];

export const TrainIcons = () => {
  const map = useMapLibre();
  const {
    setSelectedItem,
    selectedItem,
    interpolatedTrainMovement,
    smoothInterpolatedTrainMovement,
    trainModelsOnMap,
    trainStatic,
  } = useAppContext();
  const { trainRealtime, timetables, cacheTimetables } = useLiveTrainData();

  const positionsRef = useRef<TrainPosition[]>([]);
  const timetablesByTripIdRef = useRef<Map<string, TimetableData>>(timetables);
  const tripUpdatesFetchedAtRef = useRef(trainRealtime.tripUpdates.fetchedAt);
  const tracksRef = useRef<TrainTracksResponse>(trainStatic.tracks);
  const motionCacheRef = useRef(createTrainMotionCache());
  const selectedItemRef = useRef(selectedItem);
  const interpolatedRef = useRef(interpolatedTrainMovement);
  const prefetchRetryAtRef = useRef<Map<string, number>>(new Map());
  const inFlightTimetableTripIdsRef = useRef<Set<string>>(new Set());
  const schedulePrefetchRef = useRef<(() => void) | null>(null);
  const lastFeaturesKeyRef = useRef("");
  const modelsLayerRef = useRef<TrainModelsLayer | null>(null);

  const fetchAndCacheTimetables = useCallback(
    async (tripIds: string[]) => {
      const now = Date.now();
      const missingTripIds = uniqueTripIds(tripIds).filter((tripId) => {
        const cached = timetablesByTripIdRef.current.get(tripId);
        if (cached && !isTimetableStale(cached, tripUpdatesFetchedAtRef.current)) return false;
        if (inFlightTimetableTripIdsRef.current.has(tripId)) return false;
        return (prefetchRetryAtRef.current.get(tripId) ?? 0) <= now;
      });
      if (missingTripIds.length === 0) return;

      for (const tripId of missingTripIds) {
        inFlightTimetableTripIdsRef.current.add(tripId);
      }

      try {
        const data = await getTrainTimetableBulk(missingTripIds);
        cacheTimetables(data.filter(isTimetableData));
        const missingRetryAt = Date.now() + MISSING_TIMETABLE_RETRY_MS;
        for (const [index, tripId] of missingTripIds.entries()) {
          if (isTimetableData(data[index])) {
            prefetchRetryAtRef.current.delete(tripId);
          } else {
            prefetchRetryAtRef.current.set(tripId, missingRetryAt);
          }
        }
      } catch {
        const failedRetryAt = Date.now() + FAILED_PREFETCH_RETRY_MS;
        for (const tripId of missingTripIds) {
          prefetchRetryAtRef.current.set(tripId, failedRetryAt);
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

  const syncPositionsData = useCallback(() => {
    if (!map) return;
    if (isMapRemoved(map)) return;
    const source = getGeoJSONSource(map, TRAIN_POSITIONS_SOURCE_ID);
    if (!source) return;

    const nowEpochSeconds = Date.now() / 1000;
    const interpolate = interpolatedRef.current;

    const features = buildTrainPositionFeatures(positionsRef.current, {
      nowEpochSeconds,
      bounds: paddedVisibleBounds(map, VIEWPORT_PADDING_RATIO),
      selectedTrain: getSelectedTrain(),
      resolveDisplayPosition: (position, target) => {
        target.longitude = position.longitude;
        target.latitude = position.latitude;
        target.bearing = position.bearing ?? null;
        if (!interpolate) return;

        const sample = motionCacheRef.current.sample(
          position,
          timetablesByTripIdRef.current.get(position.tripId),
          tracksRef.current,
          nowEpochSeconds
        );
        if (sample == null) {
          target.bearing = null;
          return;
        }
        target.longitude = sample.longitude;
        target.latitude = sample.latitude;
        target.bearing = sample.bearing;
      },
    });

    modelsLayerRef.current?.update(
      features.map(({ geometry, properties }): TrainModelInstance => {
        const tripId = String(properties?.tripId ?? "");
        const timetable = timetablesByTripIdRef.current.get(tripId);
        return {
          key: `${tripId}|${properties?.vehicleId ?? ""}`,
          fleetCode: properties?.fleetCode ?? null,
          longitude: geometry.coordinates[0],
          latitude: geometry.coordinates[1],
          bearing: properties?.bearing ?? null,
          destination: describeTrainDestination({
            tripHeadsign: timetable?.tripHeadsign,
            vehicleLabel: properties?.vehicleLabel,
            lastStopName: timetable?.stops[timetable.stops.length - 1]?.stopName,
          }),
        };
      })
    );

    const featuresKey = trainPositionFeaturesKey(features);
    if (featuresKey === lastFeaturesKeyRef.current) return;
    lastFeaturesKeyRef.current = featuresKey;
    source.setData({ type: "FeatureCollection", features });
  }, [map, getSelectedTrain]);

  useEffect(() => {
    timetablesByTripIdRef.current = timetables;
    syncPositionsData();
  }, [timetables, syncPositionsData]);

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

    const addLayer = () => {
      if (isMapRemoved(map)) return;
      addTrainPositionsLayer(map);
      lastFeaturesKeyRef.current = "";
      syncTrainOverlayLayerOrder(map);
      syncPositionsData();
    };
    addLayer();

    const onMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onMouseLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [TRAIN_POSITIONS_LAYER_ID] });
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
      setSelectedItem({ type: "train", data: selectedTrain });
    };

    map.on("style.load", addLayer);
    map.on("moveend", syncPositionsData);
    map.on("mouseenter", TRAIN_POSITIONS_LAYER_ID, onMouseEnter);
    map.on("mouseleave", TRAIN_POSITIONS_LAYER_ID, onMouseLeave);
    map.on("click", TRAIN_POSITIONS_LAYER_ID, onClick);

    return () => {
      if (isMapRemoved(map)) return;
      map.off("style.load", addLayer);
      map.off("moveend", syncPositionsData);
      map.off("mouseenter", TRAIN_POSITIONS_LAYER_ID, onMouseEnter);
      map.off("mouseleave", TRAIN_POSITIONS_LAYER_ID, onMouseLeave);
      map.off("click", TRAIN_POSITIONS_LAYER_ID, onClick);
      removeTrainPositionsLayer(map);
    };
  }, [map, setSelectedItem, syncPositionsData]);

  useEffect(() => {
    if (!map || !trainModelsOnMap) return;
    if (isMapRemoved(map)) return;

    let cancelled = false;
    let modelsLayer: TrainModelsLayer | null = null;
    let addLayer: (() => void) | null = null;

    import("./trainModelsLayer")
      .then(({ createTrainModelsLayer, TRAIN_MODELS_ON_MAP_SETTINGS }) => {
        if (cancelled || isMapRemoved(map)) return;
        const layer = createTrainModelsLayer(map);
        modelsLayer = layer;
        modelsLayerRef.current = layer;

        addLayer = () => {
          if (isMapRemoved(map)) return;
          if (!map.getLayer(TRAIN_MODELS_LAYER_ID)) map.addLayer(layer.layer);
          hideTrainIconsFromZoom(map, TRAIN_MODELS_ON_MAP_SETTINGS.minZoom);
          syncTrainOverlayLayerOrder(map);
          syncPositionsData();
        };
        addLayer();
        map.on("style.load", addLayer);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      modelsLayerRef.current = null;
      modelsLayer?.destroy();
      if (isMapRemoved(map)) return;
      if (addLayer) map.off("style.load", addLayer);
      if (map.getLayer(TRAIN_MODELS_LAYER_ID)) map.removeLayer(TRAIN_MODELS_LAYER_ID);
      hideTrainIconsFromZoom(map, null);
    };
  }, [map, trainModelsOnMap, syncPositionsData]);

  useEffect(() => {
    tripUpdatesFetchedAtRef.current = trainRealtime.tripUpdates.fetchedAt;
  }, [trainRealtime.tripUpdates.fetchedAt]);

  useEffect(() => {
    positionsRef.current = trainRealtime.positions.items;
    motionCacheRef.current.retainOnly(trainRealtime.positions.items);
    syncPositionsData();
    schedulePrefetchRef.current?.();
  }, [trainRealtime.positions, syncPositionsData]);

  useEffect(() => {
    if (!map) return;
    if (isMapRemoved(map)) return;
    if (!interpolatedTrainMovement) return;

    let frameId: number | null = null;
    let lastUpdateMs = 0;
    const animate = (frameMs: number) => {
      frameId = window.requestAnimationFrame(animate);
      if (isMapRemoved(map)) return;
      // Pushing geometry mid-gesture just competes with the pan/zoom the user is doing
      if (map.isMoving()) return;
      if (frameMs - lastUpdateMs < trainUpdateIntervalMs(map, smoothInterpolatedTrainMovement)) {
        return;
      }
      lastUpdateMs = frameMs;
      syncPositionsData();
    };
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
      const bounds = paddedVisibleBounds(map, VIEWPORT_PADDING_RATIO);
      void fetchAndCacheTimetables(
        uniqueTripIds(
          positionsRef.current
            .filter((position) => isWithinBounds(bounds, position.longitude, position.latitude))
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
