import { resolveNextStopForBearing } from "@/lib/timetableStopMoments";
import type { TimetableData } from "@/types/train/timetable";
import type { TrainTracksResponse } from "@/types/train/tracks";
import type { TrainPosition } from "@/types/train/train";

export const computeBearing = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1R = (lat1 * Math.PI) / 180;
  const lat2R = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

const pointToSegmentDistSq = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
};

export const nearestTrackBearing = (
  lat: number,
  lon: number,
  routeId: string,
  tracks: TrainTracksResponse
): number | null => {
  const routeTracks = tracks.features.filter((f) => f.properties.route_id === routeId);
  if (routeTracks.length === 0) return null;

  let minDistSq = Infinity;
  let bestBearing: number | null = null;

  for (const track of routeTracks) {
    const coords = track.geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      const [x1, y1] = coords[i];
      const [x2, y2] = coords[i + 1];
      const distSq = pointToSegmentDistSq(lon, lat, x1, y1, x2, y2);
      if (distSq < minDistSq) {
        minDistSq = distSq;
        bestBearing = computeBearing(y1, x1, y2, x2);
      }
    }
  }

  return bestBearing;
};

export const effectiveBearing = (
  p: TrainPosition,
  timetables: TimetableData[],
  tracks: TrainTracksResponse,
  nowEpochSeconds: number
): number => {
  const timetable = timetables.find((t) => t != null && t.tripId === p.tripId);
  const nextStop =
    timetable?.stops != null && timetable.stops.length > 0
      ? resolveNextStopForBearing(
          timetable.stops,
          nowEpochSeconds,
          p.currentStopSequence,
          p.latitude,
          p.longitude
        )
      : null;

  let nextStopBearing: number | null = null;
  if (nextStop?.latitude != null && nextStop?.longitude != null) {
    nextStopBearing = computeBearing(
      p.latitude,
      p.longitude,
      nextStop.latitude,
      nextStop.longitude
    );
  }

  const trackBearing = nearestTrackBearing(p.latitude, p.longitude, p.routeId, tracks);
  if (trackBearing !== null && nextStopBearing !== null) {
    const diff = Math.abs(((nextStopBearing - trackBearing + 540) % 360) - 180);
    return diff > 90 ? (trackBearing + 180) % 360 : trackBearing;
  }
  if (trackBearing !== null) {
    return trackBearing;
  }
  return nextStopBearing ?? 0;
};
