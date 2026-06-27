import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { loadMapState, saveMapState } from "@/lib/localStorage";
import { useAppContext } from "@/providers/AppProvider";
import { TrainIcons } from "../TrainIcons/TrainIcons";
import { TrainStations } from "../TrainStations/TrainStations";
import { TrainLines } from "../TrainTracks/TrainTracks";
import { Buildings3D } from "./Buildings3D";
import { MapContext } from "./MapContext";
import styles from "./MapView.module.css";
import { TileLayerSelector } from "./TileLayerSelector";
import type { TileLayerOption } from "./tileLayers";
import { TILE_LAYERS } from "./tileLayers";

const DEBOUNCE_MS = 300;

// SW corner [lng, lat], NE corner [lng, lat] - MapLibre uses [lng, lat]
const NSW_BOUNDS: [[number, number], [number, number]] = [
  [138.999, -39.505],
  [159.639, -26.157],
];
const MAX_ZOOM = 20;
const MIN_ZOOM = 7;

export const MapView = () => {
  const { currentPage, mapReady, setMapReady } = useAppContext();
  const [storedState] = useState(loadMapState);
  const [selectedLayer, setSelectedLayer] = useState<TileLayerOption>(
    () => TILE_LAYERS.find((l) => l.id === storedState.layerId) ?? TILE_LAYERS[0]
  );
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialMapConfigRef = useRef({
    center: [storedState.center[1], storedState.center[0]] as [number, number],
    zoom: storedState.zoom,
    bearing: storedState.bearing,
    style: selectedLayer.style,
  });

  useEffect(() => {
    saveMapState({ layerId: selectedLayer.id });
  }, [selectedLayer]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    const { center, zoom, bearing, style } = initialMapConfigRef.current;

    const mapInstance = new maplibregl.Map({
      container: mapContainerRef.current,
      style,
      center,
      zoom,
      bearing,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      maxBounds: NSW_BOUNDS,
      pitch: 0,
    });

    mapInstance.addControl(new maplibregl.NavigationControl(), "top-left");

    const handler = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        const c = mapInstance.getCenter();
        saveMapState({
          center: [c.lat, c.lng],
          zoom: mapInstance.getZoom(),
          bearing: mapInstance.getBearing(),
        });
      }, DEBOUNCE_MS);
    };
    mapInstance.on("moveend", handler);

    setMap(mapInstance);
    mapInstance.on("style.load", () => {
      setMapReady(true);
    });

    return () => {
      mapInstance.off("moveend", handler);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      mapInstance.remove();
      setMap(null);
    };
  }, [setMapReady]);

  const hasAppliedLayerRef = useRef(false);
  useEffect(() => {
    if (!map) return;
    if (!hasAppliedLayerRef.current) {
      hasAppliedLayerRef.current = true;
      return;
    }
    map.setStyle(selectedLayer.style);
  }, [map, selectedLayer]);

  return (
    <div className={styles.mapWrapper}>
      <div ref={mapContainerRef} className={styles.map} />
      {map && (
        <MapContext.Provider value={map}>
          <Buildings3D layerId={selectedLayer.id} />
          {currentPage === "trains" && mapReady && (
            <>
              <TrainLines />
              <TrainStations />
              <TrainIcons />
            </>
          )}
          <TileLayerSelector
            layers={TILE_LAYERS}
            selected={selectedLayer}
            onChange={setSelectedLayer}
          />
        </MapContext.Provider>
      )}
    </div>
  );
};
