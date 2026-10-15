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
import { Terrain3D } from "./Terrain3D";
import { TileLayerSelector } from "./TileLayerSelector";
import type { TileLayerOption } from "./tileLayers";
import { NO_SATELLITE_IMAGERY, registerSatelliteProtocol, TILE_LAYERS } from "./tileLayers";

const DEBOUNCE_MS = 300;

// SW corner [lng, lat], NE corner [lng, lat] - MapLibre uses [lng, lat]
const NSW_BOUNDS: [[number, number], [number, number]] = [
  [138.999, -39.505],
  [159.639, -26.157],
];
const MAX_ZOOM = 22;
const MAX_PITCH = 75;
const MIN_ZOOM = 7;
const MAX_PIXEL_RATIO = 2;
const SYMBOL_FADE_MS = 300;
const SYMBOL_FADE_MIN_ZOOM = 14;

// Fading symbols keeps the map redrawing after every train update, which costs more than it saves
// when zoomed out; zoomed in, the fade throttles label placement, which is the bigger cost
const syncSymbolFade = (map: maplibregl.Map) => {
  const internal = map as unknown as { _fadeDuration?: number };
  if (typeof internal._fadeDuration !== "number") return;
  internal._fadeDuration = map.getZoom() < SYMBOL_FADE_MIN_ZOOM ? 0 : SYMBOL_FADE_MS;
};

export const MapView = () => {
  const { mapReady, setMapReady } = useAppContext();
  const [storedState] = useState(loadMapState);
  const [selectedLayer, setSelectedLayer] = useState<TileLayerOption>(
    () => TILE_LAYERS.find((l) => l.id === storedState.layerId) ?? TILE_LAYERS[0]
  );
  const [terrain3d, setTerrain3d] = useState(() => storedState.terrain3d);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialMapConfigRef = useRef({
    center: [storedState.center[1], storedState.center[0]] as [number, number],
    zoom: storedState.zoom,
    bearing: storedState.bearing,
    pitch: storedState.pitch,
    style: selectedLayer.style,
  });

  useEffect(() => {
    saveMapState({ layerId: selectedLayer.id });
  }, [selectedLayer]);

  useEffect(() => {
    saveMapState({ terrain3d });
  }, [terrain3d]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    const { center, zoom, bearing, pitch, style } = initialMapConfigRef.current;

    registerSatelliteProtocol();
    const mapInstance = new maplibregl.Map({
      container: mapContainerRef.current,
      style,
      center,
      zoom,
      bearing,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      maxBounds: NSW_BOUNDS,
      pitch,
      maxPitch: MAX_PITCH,
      attributionControl: { compact: true },
      fadeDuration: zoom < SYMBOL_FADE_MIN_ZOOM ? 0 : SYMBOL_FADE_MS,
      pixelRatio: Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO),
    });

    mapInstance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
    mapInstance.on("zoomend", () => syncSymbolFade(mapInstance));
    mapInstance.on("error", (event) => {
      if (event.error?.message !== NO_SATELLITE_IMAGERY) console.error(event.error);
    });

    const collapseAttribution = () => {
      const attrib = mapInstance.getContainer().querySelector(".maplibregl-ctrl-attrib");
      if (!attrib || attrib.classList.contains("maplibregl-attrib-empty")) return;
      attrib.classList.remove("maplibregl-compact-show");
      mapInstance.off("styledata", collapseAttribution);
    };
    mapInstance.on("styledata", collapseAttribution);

    const handler = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        const c = mapInstance.getCenter();
        saveMapState({
          center: [c.lat, c.lng],
          zoom: mapInstance.getZoom(),
          bearing: mapInstance.getBearing(),
          pitch: mapInstance.getPitch(),
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
      <div
        ref={mapContainerRef}
        className={styles.map}
        style={{ background: selectedLayer.background }}
      />
      {map && (
        <MapContext.Provider value={map}>
          <Terrain3D enabled={terrain3d} layerId={selectedLayer.id} />
          <Buildings3D layerId={selectedLayer.id} />
          {mapReady && (
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
            terrainEnabled={terrain3d}
            onTerrainChange={setTerrain3d}
          />
        </MapContext.Provider>
      )}
    </div>
  );
};
