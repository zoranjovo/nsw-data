import type maplibregl from "maplibre-gl";
import { useCallback, useEffect, useRef } from "react";
import { getTrainTimetableBulk } from "@/client-api/train";
import { isTimetableStale } from "@/lib/timetableRefresh";
import { describeTrainDestination } from "@/lib/trainDestination";
import { isSameTrain, trainKey } from "@/lib/trainIdentity";
import { createTrainMotionCache } from "@/lib/trainMotionCache";
import { useAppContext, useLiveTrainData } from "@/providers/AppProvider";
import { isTimetableData, type TimetableData } from "@/types/train/timetable";
import type { TrainTracksResponse } from "@/types/train/tracks";
import type { TrainPosition } from "@/types/train/train";
import { isMapRemoved, useMapLibre } from "../MapView/MapContext";
import { isWithinBounds, metersPerPixel, paddedVisibleBounds } from "../MapView/mapViewport";
import {
  syncTrainOverlayLayerOrder,
  TRAIN_MODELS_LAYER_ID,
  TRAIN_POSITIONS_LAYER_ID,
} from "../trainMapLayers";
import { pickTrainMarker, type TrainMarker, trainIconSizePx } from "./trainMarkers";
import { createTrainMarkersLayer, type TrainMarkersLayer } from "./trainMarkersLayer";
import type { TrainModelsLayer } from "./trainModelsLayer";
import { trainUpdateIntervalMs } from "./trainUpdateRate";

const TIMETABLE_PREFETCH_DEBOUNCE_MS = 200;
const MISSING_TIMETABLE_RETRY_MS = 10 * 60 * 1000;
const FAILED_PREFETCH_RETRY_MS = 30 * 1000;
const VIEWPORT_PADDING_RATIO = 0.25;
const STALE_POSITION_SECONDS = 10 * 60;
const SAMPLE_REUSE_MS = 4;
const MIN_PICK_RADIUS_PX = 10;
const MODEL_PICK_HALF_LENGTH_M = 11;
// Interpolated positions can sit a few km from the raw feed position, so keep a wide margin
const NEAR_VIEW_MARGIN_DEGREES = 0.05;

const uniqueTripIds = (tripIds: string[]): string[] => [
  ...new Set(tripIds.filter((tripId) => tripId.trim().length > 0)),
];

export const TrainIcons = () => {
  const map = useMapLibre();
  const {
    setSelectedItem,
    selectedItem,
    interpolatedTrainMovement,
    smoothBackgroundMovement,
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
  const markersRef = useRef<TrainMarker[]>([]);
  const lastSampledAtRef = useRef(Number.NEGATIVE_INFINITY);
  const markersLayerRef = useRef<TrainMarkersLayer | null>(null);
  const modelsMinZoomRef = useRef<number | null>(null);

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

  const repaint = useCallback(() => {
    if (map && !isMapRemoved(map)) map.triggerRepaint();
  }, [map]);

  const rebuildMarkers = useCallback(() => {
    const selectedTrain = getSelectedTrain();
    markersRef.current = positionsRef.current.map((position): TrainMarker => {
      const timetable = timetablesByTripIdRef.current.get(position.tripId);
      return {
        key: trainKey(position),
        position,
        fleetCode: position.fleetCode ?? null,
        destination: describeTrainDestination({
          tripHeadsign: timetable?.tripHeadsign,
          vehicleLabel: position.vehicleLabel,
          lastStopName: timetable?.stops[timetable.stops.length - 1]?.stopName,
        }),
        isSelected: isSameTrain(position, selectedTrain),
        longitude: position.longitude,
        latitude: position.latitude,
        bearing: position.bearing ?? null,
        isStale: false,
        isNearView: true,
      };
    });
    lastSampledAtRef.current = Number.NEGATIVE_INFINITY;
    repaint();
  }, [getSelectedTrain, repaint]);

  // Both map layers ask for positions while drawing the same frame, so one sample serves both
  const getMarkers = useCallback((): readonly TrainMarker[] => {
    const now = performance.now();
    if (now - lastSampledAtRef.current < SAMPLE_REUSE_MS) return markersRef.current;
    lastSampledAtRef.current = now;

    const nowEpochSeconds = Date.now() / 1000;
    const bounds =
      map && !isMapRemoved(map) ? paddedVisibleBounds(map, VIEWPORT_PADDING_RATIO) : null;
    for (const marker of markersRef.current) {
      const { position } = marker;
      marker.isNearView =
        bounds == null ||
        (position.latitude >= bounds.minLat - NEAR_VIEW_MARGIN_DEGREES &&
          position.latitude <= bounds.maxLat + NEAR_VIEW_MARGIN_DEGREES &&
          position.longitude >= bounds.minLng - NEAR_VIEW_MARGIN_DEGREES &&
          position.longitude <= bounds.maxLng + NEAR_VIEW_MARGIN_DEGREES);
      if (!marker.isNearView) continue;
      marker.isStale =
        position.timestamp != null && nowEpochSeconds - position.timestamp > STALE_POSITION_SECONDS;
      marker.longitude = position.longitude;
      marker.latitude = position.latitude;
      marker.bearing = position.bearing ?? null;
      if (!interpolatedRef.current) continue;

      const sample = motionCacheRef.current.sample(
        position,
        timetablesByTripIdRef.current.get(position.tripId),
        tracksRef.current,
        nowEpochSeconds
      );
      if (sample == null) {
        marker.bearing = null;
        continue;
      }
      marker.longitude = sample.longitude;
      marker.latitude = sample.latitude;
      marker.bearing = sample.bearing;
    }
    return markersRef.current;
  }, [map]);

  useEffect(() => {
    timetablesByTripIdRef.current = timetables;
    rebuildMarkers();
  }, [timetables, rebuildMarkers]);

  useEffect(() => {
    tracksRef.current = trainStatic.tracks;
    lastSampledAtRef.current = Number.NEGATIVE_INFINITY;
    repaint();
  }, [trainStatic.tracks, repaint]);

  useEffect(() => {
    interpolatedRef.current = interpolatedTrainMovement;
    lastSampledAtRef.current = Number.NEGATIVE_INFINITY;
    repaint();
  }, [interpolatedTrainMovement, repaint]);

  useEffect(() => {
    selectedItemRef.current = selectedItem;
    rebuildMarkers();
  }, [selectedItem, rebuildMarkers]);

  useEffect(() => {
    if (!map) return;

    const markersLayer = createTrainMarkersLayer(map, getMarkers);
    markersLayerRef.current = markersLayer;

    const addLayer = () => {
      if (isMapRemoved(map)) return;
      if (!map.getLayer(TRAIN_POSITIONS_LAYER_ID)) map.addLayer(markersLayer.layer);
      syncTrainOverlayLayerOrder(map);
    };
    addLayer();

    const pickAt = (point: maplibregl.Point): TrainMarker | null => {
      const zoom = map.getZoom();
      let radius = Math.max(MIN_PICK_RADIUS_PX, trainIconSizePx(zoom) / 2);
      if (modelsMinZoomRef.current != null && zoom >= modelsMinZoomRef.current) {
        radius = Math.max(radius, MODEL_PICK_HALF_LENGTH_M / metersPerPixel(map));
      }
      return pickTrainMarker(getMarkers(), point, radius, (longitude, latitude) =>
        map.project([longitude, latitude])
      );
    };

    let hovering = false;
    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      const overTrain = pickAt(e.point) != null;
      if (overTrain === hovering) return;
      hovering = overTrain;
      map.getCanvas().style.cursor = overTrain ? "pointer" : "";
    };

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const marker = pickAt(e.point);
      if (marker) setSelectedItem({ type: "train", data: marker.position });
    };

    map.on("style.load", addLayer);
    map.on("mousemove", onMouseMove);
    map.on("click", onClick);

    return () => {
      markersLayerRef.current = null;
      if (isMapRemoved(map)) return;
      map.off("style.load", addLayer);
      map.off("mousemove", onMouseMove);
      map.off("click", onClick);
      if (hovering) map.getCanvas().style.cursor = "";
      if (map.getLayer(TRAIN_POSITIONS_LAYER_ID)) map.removeLayer(TRAIN_POSITIONS_LAYER_ID);
    };
  }, [map, setSelectedItem, getMarkers]);

  useEffect(() => {
    if (!map || !trainModelsOnMap) return;
    if (isMapRemoved(map)) return;

    let cancelled = false;
    let modelsLayer: TrainModelsLayer | null = null;
    let addLayer: (() => void) | null = null;

    import("./trainModelsLayer")
      .then(({ createTrainModelsLayer, TRAIN_MODELS_ON_MAP_SETTINGS }) => {
        if (cancelled || isMapRemoved(map)) return;
        const layer = createTrainModelsLayer(map, getMarkers);
        modelsLayer = layer;
        modelsMinZoomRef.current = TRAIN_MODELS_ON_MAP_SETTINGS.minZoom;

        addLayer = () => {
          if (isMapRemoved(map)) return;
          if (!map.getLayer(TRAIN_MODELS_LAYER_ID)) map.addLayer(layer.layer);
          markersLayerRef.current?.hideFromZoom(TRAIN_MODELS_ON_MAP_SETTINGS.minZoom);
          syncTrainOverlayLayerOrder(map);
        };
        addLayer();
        map.on("style.load", addLayer);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      modelsMinZoomRef.current = null;
      modelsLayer?.destroy();
      markersLayerRef.current?.hideFromZoom(null);
      if (isMapRemoved(map)) return;
      if (addLayer) map.off("style.load", addLayer);
      if (map.getLayer(TRAIN_MODELS_LAYER_ID)) map.removeLayer(TRAIN_MODELS_LAYER_ID);
    };
  }, [map, trainModelsOnMap, getMarkers]);

  useEffect(() => {
    tripUpdatesFetchedAtRef.current = trainRealtime.tripUpdates.fetchedAt;
  }, [trainRealtime.tripUpdates.fetchedAt]);

  useEffect(() => {
    positionsRef.current = trainRealtime.positions.items;
    motionCacheRef.current.retainOnly(trainRealtime.positions.items);
    rebuildMarkers();
    schedulePrefetchRef.current?.();
  }, [trainRealtime.positions, rebuildMarkers]);

  useEffect(() => {
    if (!map) return;
    if (isMapRemoved(map)) return;
    if (!interpolatedTrainMovement) return;

    let frameId: number | null = null;
    let lastRepaintMs = 0;
    const animate = (frameMs: number) => {
      frameId = window.requestAnimationFrame(animate);
      if (isMapRemoved(map)) return;
      if (frameMs - lastRepaintMs < trainUpdateIntervalMs(map, smoothBackgroundMovement)) {
        return;
      }
      lastRepaintMs = frameMs;
      map.triggerRepaint();
    };
    frameId = window.requestAnimationFrame(animate);

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [map, interpolatedTrainMovement, smoothBackgroundMovement]);

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
