import type { Map as MaplibreMap } from "maplibre-gl";

// Ground resolution at zoom 0 for maplibre 512px tile scheme
const METERS_PER_PIXEL_AT_ZOOM_0 = 78_271.516;

export type VisibleBounds = {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
};

export const metersPerPixel = (map: MaplibreMap): number => {
  const latitudeRadians = (map.getCenter().lat * Math.PI) / 180;
  return (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos(latitudeRadians)) / 2 ** map.getZoom();
};

export const paddedVisibleBounds = (map: MaplibreMap, paddingRatio: number): VisibleBounds => {
  const bounds = map.getBounds();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const padX = (east - west) * paddingRatio;
  const padY = (north - south) * paddingRatio;

  return {
    minLng: west - padX,
    maxLng: east + padX,
    minLat: south - padY,
    maxLat: north + padY,
  };
};

export const isWithinBounds = (
  bounds: VisibleBounds,
  longitude: number,
  latitude: number
): boolean =>
  longitude >= bounds.minLng &&
  longitude <= bounds.maxLng &&
  latitude >= bounds.minLat &&
  latitude <= bounds.maxLat;
