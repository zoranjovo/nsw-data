import { approxDistanceMeters, computeBearing, METERS_PER_DEGREE } from "@/lib/geo";
import { stopArrivalEpoch, stopDepartureEpoch } from "@/lib/timetableStopMoments";
import type { TimetableData, TimetableStop } from "@/types/train/timetable";
import type { TrainTrackCoordinate, TrainTracksResponse } from "@/types/train/tracks";

export type InterpolatedTrainPosition = {
  latitude: number;
  longitude: number;
  bearing: number;
};

const MAX_STOP_OFFSET_METERS = 300;
const MAX_TRACK_BACKTRACK_METERS = 200;

type TrackPath = {
  lons: Float64Array;
  lats: Float64Array;
  dists: Float64Array;
};

/** Precomputed geometry for one trip, sampled cheaply on every animation frame. */
export type TrainMotion = {
  path: TrackPath;
  times: Float64Array;
  distances: Float64Array;
  direction: number;
};

type Knot = {
  epochSeconds: number;
  latitude: number;
  longitude: number;
};

const isFiniteNumber = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

const dropBacktracks = (coordinates: TrainTrackCoordinate[]): TrainTrackCoordinate[] => {
  const kept: TrainTrackCoordinate[] = [];
  for (const point of coordinates) {
    const last = kept[kept.length - 1];
    if (last != null && point[0] === last[0] && point[1] === last[1]) continue;
    const before = kept[kept.length - 2];
    if (before != null) {
      const cosLat = Math.cos((last[1] * Math.PI) / 180);
      const inX = (last[0] - before[0]) * cosLat;
      const inY = last[1] - before[1];
      const outX = (point[0] - last[0]) * cosLat;
      const outY = point[1] - last[1];
      const turnsBack =
        inX * outX + inY * outY < -0.5 * Math.hypot(inX, inY) * Math.hypot(outX, outY);
      if (
        turnsBack &&
        approxDistanceMeters(last[1], last[0], point[1], point[0]) < MAX_TRACK_BACKTRACK_METERS
      ) {
        continue;
      }
    }
    kept.push(point);
  }
  return kept;
};

const buildTrackPath = (coordinates: TrainTrackCoordinate[]): TrackPath | null => {
  const points = dropBacktracks(dropBacktracks(coordinates).reverse()).reverse();
  if (points.length < 2) {
    return null;
  }

  const lons = Float64Array.from(points, ([longitude]) => longitude);
  const lats = Float64Array.from(points, ([, latitude]) => latitude);
  const dists = new Float64Array(points.length);
  for (let index = 1; index < points.length; index++) {
    dists[index] =
      dists[index - 1] +
      approxDistanceMeters(lats[index - 1], lons[index - 1], lats[index], lons[index]);
  }
  return { lons, lats, dists };
};

const trackPathsByResponse = new WeakMap<TrainTracksResponse, Map<string, TrackPath[]>>();

const routeTrackPaths = (tracks: TrainTracksResponse, routeId: string): TrackPath[] => {
  let byRouteId = trackPathsByResponse.get(tracks);
  if (!byRouteId) {
    byRouteId = new Map();
    trackPathsByResponse.set(tracks, byRouteId);
  }
  let paths = byRouteId.get(routeId);
  if (!paths) {
    paths = tracks.features.flatMap((feature) => {
      if (feature.properties.route_id !== routeId) return [];
      const path = buildTrackPath(feature.geometry.coordinates);
      return path ? [path] : [];
    });
    byRouteId.set(routeId, paths);
  }
  return paths;
};

type Projection = {
  distanceMeters: number;
  offsetMeters: number;
};

const nextPassOfTrack = (
  path: TrackPath,
  latitude: number,
  longitude: number,
  fromDistance: number,
  direction: number
): Projection | null => {
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const px = longitude * METERS_PER_DEGREE * cosLat;
  const py = latitude * METERS_PER_DEGREE;
  const segmentCount = path.lons.length - 1;
  let best: Projection | null = null;

  for (let step = 0; step < segmentCount; step++) {
    const index = direction > 0 ? step : segmentCount - 1 - step;
    const startDistance = path.dists[index];
    const endDistance = path.dists[index + 1];
    if (direction > 0 ? endDistance < fromDistance : startDistance > fromDistance) continue;

    const ax = path.lons[index] * METERS_PER_DEGREE * cosLat;
    const ay = path.lats[index] * METERS_PER_DEGREE;
    const dx = path.lons[index + 1] * METERS_PER_DEGREE * cosLat - ax;
    const dy = path.lats[index + 1] * METERS_PER_DEGREE - ay;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    let distanceMeters = startDistance + (endDistance - startDistance) * t;
    if (direction * (distanceMeters - fromDistance) < 0) {
      distanceMeters = fromDistance;
      t = (fromDistance - startDistance) / (endDistance - startDistance);
    }
    const offsetMeters = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));

    if (offsetMeters <= MAX_STOP_OFFSET_METERS) {
      if (best == null || offsetMeters < best.offsetMeters) {
        best = { distanceMeters, offsetMeters };
      }
    } else if (best != null) {
      return best;
    }
  }
  return best;
};

const shiftEpoch = (epochSeconds: number | null, delaySeconds: number): number | null =>
  epochSeconds == null || epochSeconds === 0 ? null : epochSeconds + delaySeconds;

const reportedDelaySeconds = (stop: TimetableStop): number | null => {
  if (!stop.hasRealtimeStopUpdate) return null;
  const arrival = stopArrivalEpoch(stop);
  if (arrival != null && stop.scheduledArrivalTimestamp) {
    return arrival - stop.scheduledArrivalTimestamp;
  }
  const departure = stopDepartureEpoch(stop);
  if (departure != null && stop.scheduledDepartureTimestamp) {
    return departure - stop.scheduledDepartureTimestamp;
  }
  return null;
};

const buildStopKnots = (stops: TimetableStop[]): Knot[] => {
  const calling = stops.filter(
    (stop) => !stop.skipped && isFiniteNumber(stop.latitude) && isFiniteNumber(stop.longitude)
  );

  const delays = calling.map(reportedDelaySeconds);
  for (let index = 1; index < delays.length; index++) {
    delays[index] ??= delays[index - 1];
  }
  for (let index = delays.length - 2; index >= 0; index--) {
    delays[index] ??= delays[index + 1];
  }

  const knots = calling.flatMap<Knot>((stop, index) => {
    const delay = delays[index] ?? 0;
    const epochs = stop.hasRealtimeStopUpdate
      ? [stopArrivalEpoch(stop), stopDepartureEpoch(stop)]
      : [
          shiftEpoch(stop.scheduledArrivalTimestamp, delay),
          shiftEpoch(stop.scheduledDepartureTimestamp, delay),
        ];
    return [...new Set(epochs.filter(isFiniteNumber))].map((epochSeconds) => ({
      epochSeconds,
      latitude: stop.latitude as number,
      longitude: stop.longitude as number,
    }));
  });

  for (let index = knots.length - 2; index >= 0; index--) {
    knots[index].epochSeconds = Math.min(knots[index].epochSeconds, knots[index + 1].epochSeconds);
  }
  return knots;
};

type TrackFit = {
  motion: TrainMotion;
  offsetMeters: number;
};

const fitToTrack = (path: TrackPath, knots: Knot[]): TrackFit | null => {
  let best: TrackFit | null = null;
  for (const direction of [1, -1]) {
    const distances = new Float64Array(knots.length);
    let fromDistance = direction > 0 ? 0 : path.dists[path.dists.length - 1];
    let offsetMeters = 0;
    for (let index = 0; index < knots.length && offsetMeters < Infinity; index++) {
      const knot = knots[index];
      const previous = knots[index - 1];
      if (previous?.latitude !== knot.latitude || previous.longitude !== knot.longitude) {
        const projection = nextPassOfTrack(
          path,
          knot.latitude,
          knot.longitude,
          fromDistance,
          direction
        );
        offsetMeters += projection?.offsetMeters ?? Infinity;
        fromDistance = projection?.distanceMeters ?? fromDistance;
      }
      distances[index] = fromDistance;
    }
    if (offsetMeters < (best?.offsetMeters ?? Infinity)) {
      const times = Float64Array.from(knots, (knot) => knot.epochSeconds);
      best = { motion: { path, times, distances, direction }, offsetMeters };
    }
  }
  return best;
};

const bestFit = (paths: TrackPath[], knots: Knot[]): TrackFit | null => {
  let best: TrackFit | null = null;
  for (const path of paths) {
    const fit = fitToTrack(path, knots);
    if (fit != null && fit.offsetMeters < (best?.offsetMeters ?? Infinity)) {
      best = fit;
    }
  }
  return best;
};

export const buildTrainMotion = (
  timetable: TimetableData,
  tracks: TrainTracksResponse,
  routeId: string
): TrainMotion | null => {
  const knots = buildStopKnots(timetable.stops);
  if (knots.length === 0) {
    return null;
  }

  const ownFit = bestFit(routeTrackPaths(tracks, routeId), knots);
  if (ownFit != null) {
    return ownFit.motion;
  }

  const otherRouteIds = new Set(tracks.features.map((feature) => feature.properties.route_id));
  otherRouteIds.delete(routeId);
  const otherPaths = [...otherRouteIds].flatMap((otherRouteId) =>
    routeTrackPaths(tracks, otherRouteId)
  );
  return bestFit(otherPaths, knots)?.motion ?? null;
};

const firstIndexAtOrAfter = (values: Float64Array, target: number): number => {
  let low = 0;
  let high = values.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] >= target) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
};

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

export const sampleTrainMotion = (
  motion: TrainMotion,
  nowEpochSeconds: number
): InterpolatedTrainPosition => {
  const { path, times, distances, direction } = motion;

  let distanceMeters = distances[0];
  if (times.length > 1) {
    const next = Math.min(
      times.length - 1,
      Math.max(1, firstIndexAtOrAfter(times, nowEpochSeconds))
    );
    const duration = times[next] - times[next - 1];
    const progress = clamp01(duration > 0 ? (nowEpochSeconds - times[next - 1]) / duration : 1);
    distanceMeters = distances[next - 1] + (distances[next] - distances[next - 1]) * progress;
  }

  const segmentEnd = Math.min(
    path.lons.length - 1,
    Math.max(1, firstIndexAtOrAfter(path.dists, distanceMeters))
  );
  const segmentStart = segmentEnd - 1;
  const segmentMeters = path.dists[segmentEnd] - path.dists[segmentStart];
  const along = clamp01(
    segmentMeters > 0 ? (distanceMeters - path.dists[segmentStart]) / segmentMeters : 0
  );
  const bearing = computeBearing(
    path.lats[segmentStart],
    path.lons[segmentStart],
    path.lats[segmentEnd],
    path.lons[segmentEnd]
  );

  return {
    latitude: path.lats[segmentStart] + (path.lats[segmentEnd] - path.lats[segmentStart]) * along,
    longitude: path.lons[segmentStart] + (path.lons[segmentEnd] - path.lons[segmentStart]) * along,
    bearing: direction < 0 ? (bearing + 180) % 360 : bearing,
  };
};
