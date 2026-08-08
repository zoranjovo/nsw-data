import { approxDistanceMeters, computeBearing, METERS_PER_DEGREE } from "@/lib/geo";
import { stopArrivalEpoch, stopDepartureEpoch } from "@/lib/timetableStopMoments";
import type { TimetableData, TimetableStop } from "@/types/train/timetable";
import type { TrainTrackCoordinate, TrainTracksResponse } from "@/types/train/tracks";
import type { TrainPosition } from "@/types/train/train";

export type TrainAnimationWaypoint = {
  epochSeconds: number;
  latitude: number;
  longitude: number;
};

export type InterpolatedTrainPosition = {
  latitude: number;
  longitude: number;
  bearing: number;
  speedMetersPerSecond: number;
};

const SEGMENTS_PER_CHUNK = 64;

const isFiniteNumber = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

type TrackPath = {
  lons: Float64Array;
  lats: Float64Array;
  dists: Float64Array;
  xs: Float64Array;
  ys: Float64Array;
  cosLat: number;
  chunkMinX: Float64Array;
  chunkMinY: Float64Array;
  chunkMaxX: Float64Array;
  chunkMaxY: Float64Array;
  chunkDistSq: Float64Array;
};

/** Precomputed geometry for one trip, sampled cheaply on every animation frame. */
export type TrainMotion = {
  times: Float64Array;
  path: TrackPath | null;
  distances: Float64Array | null;
  latitudes: Float64Array | null;
  longitudes: Float64Array | null;
};

const stopEpochs = (stop: TimetableStop): number[] => [
  ...new Set([stopArrivalEpoch(stop), stopDepartureEpoch(stop)].filter(isFiniteNumber)),
];

const isDuringStationDwell = (stop: TimetableStop, epochSeconds: number): boolean => {
  const arrival = stopArrivalEpoch(stop);
  const departure = stopDepartureEpoch(stop);
  return (
    arrival != null && departure != null && epochSeconds >= arrival && epochSeconds <= departure
  );
};

const buildTrackPath = (coordinates: TrainTrackCoordinate[]): TrackPath | null => {
  const pointCount = coordinates.length;
  if (pointCount < 2) {
    return null;
  }

  const lons = new Float64Array(pointCount);
  const lats = new Float64Array(pointCount);
  const dists = new Float64Array(pointCount);
  const xs = new Float64Array(pointCount);
  const ys = new Float64Array(pointCount);

  let cumulativeMeters = 0;
  let latitudeSum = 0;
  for (let index = 0; index < pointCount; index++) {
    const [longitude, latitude] = coordinates[index];
    if (index > 0) {
      cumulativeMeters += approxDistanceMeters(
        lats[index - 1],
        lons[index - 1],
        latitude,
        longitude
      );
    }
    lons[index] = longitude;
    lats[index] = latitude;
    dists[index] = cumulativeMeters;
    latitudeSum += latitude;
  }

  // One shared projection origin keeps segment comparisons consistent along the path
  const cosLat = Math.cos(((latitudeSum / pointCount) * Math.PI) / 180);
  for (let index = 0; index < pointCount; index++) {
    xs[index] = lons[index] * METERS_PER_DEGREE * cosLat;
    ys[index] = lats[index] * METERS_PER_DEGREE;
  }

  const chunkCount = Math.ceil((pointCount - 1) / SEGMENTS_PER_CHUNK);
  const chunkMinX = new Float64Array(chunkCount);
  const chunkMinY = new Float64Array(chunkCount);
  const chunkMaxX = new Float64Array(chunkCount);
  const chunkMaxY = new Float64Array(chunkCount);

  for (let chunk = 0; chunk < chunkCount; chunk++) {
    const startIndex = chunk * SEGMENTS_PER_CHUNK;
    const endIndex = Math.min(pointCount - 1, startIndex + SEGMENTS_PER_CHUNK);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let index = startIndex; index <= endIndex; index++) {
      const x = xs[index];
      const y = ys[index];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    chunkMinX[chunk] = minX;
    chunkMinY[chunk] = minY;
    chunkMaxX[chunk] = maxX;
    chunkMaxY[chunk] = maxY;
  }

  return {
    lons,
    lats,
    dists,
    xs,
    ys,
    cosLat,
    chunkMinX,
    chunkMinY,
    chunkMaxX,
    chunkMaxY,
    chunkDistSq: new Float64Array(chunkCount),
  };
};

const trackPathsByResponse = new WeakMap<TrainTracksResponse, Map<string, TrackPath[]>>();

const routeTrackPaths = (tracks: TrainTracksResponse, routeId: string): TrackPath[] => {
  let byRouteId = trackPathsByResponse.get(tracks);
  if (!byRouteId) {
    byRouteId = new Map();
    trackPathsByResponse.set(tracks, byRouteId);
  }

  const cached = byRouteId.get(routeId);
  if (cached) {
    return cached;
  }

  const paths: TrackPath[] = [];
  for (const feature of tracks.features) {
    if (feature.properties.route_id !== routeId) continue;
    const path = buildTrackPath(feature.geometry.coordinates);
    if (path != null) {
      paths.push(path);
    }
  }
  byRouteId.set(routeId, paths);
  return paths;
};

let projectedDistanceMeters = 0;
let projectedDistanceSq = 0;

const scanChunkForProjection = (
  path: TrackPath,
  chunkIndex: number,
  px: number,
  py: number
): void => {
  const startIndex = chunkIndex * SEGMENTS_PER_CHUNK;
  const endIndex = Math.min(path.lons.length - 1, startIndex + SEGMENTS_PER_CHUNK);

  for (let index = startIndex; index < endIndex; index++) {
    const ax = path.xs[index];
    const ay = path.ys[index];
    const dx = path.xs[index + 1] - ax;
    const dy = path.ys[index + 1] - ay;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const offsetX = px - (ax + t * dx);
    const offsetY = py - (ay + t * dy);
    const distanceSq = offsetX * offsetX + offsetY * offsetY;
    if (distanceSq < projectedDistanceSq) {
      projectedDistanceSq = distanceSq;
      projectedDistanceMeters = path.dists[index] + (path.dists[index + 1] - path.dists[index]) * t;
    }
  }
};

/** Writes the nearest-point result into projectedDistanceMeters / projectedDistanceSq. */
const projectOntoPath = (path: TrackPath, latitude: number, longitude: number): void => {
  const px = longitude * METERS_PER_DEGREE * path.cosLat;
  const py = latitude * METERS_PER_DEGREE;
  const chunkCount = path.chunkDistSq.length;

  let nearestChunk = 0;
  let nearestChunkDistSq = Infinity;
  for (let chunk = 0; chunk < chunkCount; chunk++) {
    const minX = path.chunkMinX[chunk];
    const maxX = path.chunkMaxX[chunk];
    const minY = path.chunkMinY[chunk];
    const maxY = path.chunkMaxY[chunk];
    const gapX = px < minX ? minX - px : px > maxX ? px - maxX : 0;
    const gapY = py < minY ? minY - py : py > maxY ? py - maxY : 0;
    const distanceSq = gapX * gapX + gapY * gapY;
    path.chunkDistSq[chunk] = distanceSq;
    if (distanceSq < nearestChunkDistSq) {
      nearestChunkDistSq = distanceSq;
      nearestChunk = chunk;
    }
  }

  projectedDistanceMeters = 0;
  projectedDistanceSq = Infinity;
  scanChunkForProjection(path, nearestChunk, px, py);

  // Bounding boxes only prune, so any chunk that could still win is scanned exactly
  for (let chunk = 0; chunk < chunkCount; chunk++) {
    if (chunk === nearestChunk) continue;
    if (path.chunkDistSq[chunk] >= projectedDistanceSq) continue;
    scanChunkForProjection(path, chunk, px, py);
  }
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

const samplePathAtDistance = (
  path: TrackPath,
  distanceMeters: number,
  directionMeters: number,
  speedMetersPerSecond: number
): InterpolatedTrainPosition | null => {
  const pointCount = path.lons.length;
  if (pointCount === 0) {
    return null;
  }

  const orient = (bearing: number): number =>
    directionMeters < 0 ? (bearing + 180) % 360 : bearing;

  if (pointCount === 1 || distanceMeters <= path.dists[0]) {
    const nextIndex = pointCount > 1 ? 1 : 0;
    return {
      latitude: path.lats[0],
      longitude: path.lons[0],
      bearing: orient(
        computeBearing(path.lats[0], path.lons[0], path.lats[nextIndex], path.lons[nextIndex])
      ),
      speedMetersPerSecond,
    };
  }

  const lastIndex = pointCount - 1;
  if (distanceMeters >= path.dists[lastIndex]) {
    const previousIndex = lastIndex - 1;
    return {
      latitude: path.lats[lastIndex],
      longitude: path.lons[lastIndex],
      bearing: orient(
        computeBearing(
          path.lats[previousIndex],
          path.lons[previousIndex],
          path.lats[lastIndex],
          path.lons[lastIndex]
        )
      ),
      speedMetersPerSecond,
    };
  }

  const nextIndex = Math.max(1, firstIndexAtOrAfter(path.dists, distanceMeters));
  const previousIndex = nextIndex - 1;
  const segmentMeters = path.dists[nextIndex] - path.dists[previousIndex];
  const progress =
    segmentMeters > 0 ? (distanceMeters - path.dists[previousIndex]) / segmentMeters : 0;

  return {
    latitude:
      path.lats[previousIndex] + (path.lats[nextIndex] - path.lats[previousIndex]) * progress,
    longitude:
      path.lons[previousIndex] + (path.lons[nextIndex] - path.lons[previousIndex]) * progress,
    bearing: orient(
      computeBearing(
        path.lats[previousIndex],
        path.lons[previousIndex],
        path.lats[nextIndex],
        path.lons[nextIndex]
      )
    ),
    speedMetersPerSecond,
  };
};

export const buildAnimationWaypoints = (
  timetable: TimetableData,
  gpsPosition: TrainPosition | null
): TrainAnimationWaypoint[] => {
  const stopWaypoints = timetable.stops.flatMap<TrainAnimationWaypoint>((stop) => {
    const epochSeconds = stopEpochs(stop);
    if (
      epochSeconds.length === 0 ||
      !isFiniteNumber(stop.latitude) ||
      !isFiniteNumber(stop.longitude)
    ) {
      return [];
    }
    const latitude = stop.latitude;
    const longitude = stop.longitude;

    return epochSeconds.map((epochSecond) => ({
      epochSeconds: epochSecond,
      latitude,
      longitude,
    }));
  });

  stopWaypoints.sort((a, b) => a.epochSeconds - b.epochSeconds);

  const firstStopTime = stopWaypoints[0]?.epochSeconds;
  const lastStopTime = stopWaypoints[stopWaypoints.length - 1]?.epochSeconds;
  if (
    gpsPosition?.timestamp != null &&
    firstStopTime != null &&
    lastStopTime != null &&
    gpsPosition.timestamp >= firstStopTime &&
    gpsPosition.timestamp <= lastStopTime
  ) {
    const isDwellTimestamp = timetable.stops.some((stop) =>
      isDuringStationDwell(stop, gpsPosition.timestamp as number)
    );
    if (!isDwellTimestamp) {
      stopWaypoints.push({
        epochSeconds: gpsPosition.timestamp,
        latitude: gpsPosition.latitude,
        longitude: gpsPosition.longitude,
      });
      stopWaypoints.sort((a, b) => a.epochSeconds - b.epochSeconds);
    }
  }

  return stopWaypoints.filter(
    (waypoint, index, waypoints) =>
      index === waypoints.length - 1 || waypoint.epochSeconds !== waypoints[index + 1].epochSeconds
  );
};

const buildTrackMotion = (
  waypoints: TrainAnimationWaypoint[],
  tracks: TrainTracksResponse,
  routeId: string
): TrainMotion | null => {
  const paths = routeTrackPaths(tracks, routeId);
  if (paths.length === 0) {
    return null;
  }

  const waypointCount = waypoints.length;
  let bestPath: TrackPath | null = null;
  let bestDistances: Float64Array | null = null;
  let bestScore = Infinity;

  for (const path of paths) {
    const distances = new Float64Array(waypointCount);
    let score = 0;
    for (let index = 0; index < waypointCount; index++) {
      projectOntoPath(path, waypoints[index].latitude, waypoints[index].longitude);
      distances[index] = projectedDistanceMeters;
      score += projectedDistanceSq;
    }
    if (score < bestScore) {
      bestScore = score;
      bestPath = path;
      bestDistances = distances;
    }
  }

  if (bestPath == null || bestDistances == null) {
    return null;
  }

  const times = new Float64Array(waypointCount);
  for (let index = 0; index < waypointCount; index++) {
    times[index] = waypoints[index].epochSeconds;
  }

  return { times, path: bestPath, distances: bestDistances, latitudes: null, longitudes: null };
};

export const buildTrainMotion = (
  timetable: TimetableData,
  gpsPosition: TrainPosition | null,
  tracks?: TrainTracksResponse,
  routeId?: string
): TrainMotion | null => {
  const waypoints = buildAnimationWaypoints(timetable, gpsPosition);
  if (waypoints.length === 0) {
    return null;
  }

  if (tracks != null && routeId != null && routeId.length > 0) {
    const trackMotion = buildTrackMotion(waypoints, tracks, routeId);
    if (trackMotion != null) {
      return trackMotion;
    }
  }

  const waypointCount = waypoints.length;
  const times = new Float64Array(waypointCount);
  const latitudes = new Float64Array(waypointCount);
  const longitudes = new Float64Array(waypointCount);
  for (let index = 0; index < waypointCount; index++) {
    times[index] = waypoints[index].epochSeconds;
    latitudes[index] = waypoints[index].latitude;
    longitudes[index] = waypoints[index].longitude;
  }

  return { times, path: null, distances: null, latitudes, longitudes };
};

const sampleAlongTrack = (
  motion: TrainMotion,
  path: TrackPath,
  distances: Float64Array,
  nowEpochSeconds: number
): InterpolatedTrainPosition | null => {
  const times = motion.times;
  const count = times.length;

  if (count === 1) {
    return samplePathAtDistance(path, distances[0], 0, 0);
  }

  if (nowEpochSeconds <= times[0]) {
    const duration = times[1] - times[0];
    const legMeters = Math.abs(distances[1] - distances[0]);
    return samplePathAtDistance(
      path,
      distances[0],
      distances[1] - distances[0],
      duration > 0 ? legMeters / duration : 0
    );
  }

  const lastIndex = count - 1;
  if (nowEpochSeconds >= times[lastIndex]) {
    const previousIndex = lastIndex - 1;
    const duration = times[lastIndex] - times[previousIndex];
    const legMeters = Math.abs(distances[lastIndex] - distances[previousIndex]);
    return samplePathAtDistance(
      path,
      distances[lastIndex],
      distances[lastIndex] - distances[previousIndex],
      duration > 0 ? legMeters / duration : 0
    );
  }

  const nextIndex = Math.max(1, firstIndexAtOrAfter(times, nowEpochSeconds));
  const previousIndex = nextIndex - 1;
  const duration = times[nextIndex] - times[previousIndex];
  const progress = duration > 0 ? (nowEpochSeconds - times[previousIndex]) / duration : 0;
  const distanceMeters =
    distances[previousIndex] + (distances[nextIndex] - distances[previousIndex]) * progress;
  const legMeters = Math.abs(distances[nextIndex] - distances[previousIndex]);

  return samplePathAtDistance(
    path,
    distanceMeters,
    distances[nextIndex] - distances[previousIndex],
    duration > 0 ? legMeters / duration : 0
  );
};

export const sampleTrainMotion = (
  motion: TrainMotion,
  nowEpochSeconds: number
): InterpolatedTrainPosition | null => {
  const times = motion.times;
  const count = times.length;
  if (count === 0) {
    return null;
  }

  if (motion.path != null && motion.distances != null) {
    return sampleAlongTrack(motion, motion.path, motion.distances, nowEpochSeconds);
  }

  const latitudes = motion.latitudes;
  const longitudes = motion.longitudes;
  if (latitudes == null || longitudes == null) {
    return null;
  }

  if (count === 1 || nowEpochSeconds <= times[0]) {
    const nextIndex = count > 1 ? 1 : 0;
    return {
      latitude: latitudes[0],
      longitude: longitudes[0],
      bearing: computeBearing(
        latitudes[0],
        longitudes[0],
        latitudes[nextIndex],
        longitudes[nextIndex]
      ),
      speedMetersPerSecond: 0,
    };
  }

  const lastIndex = count - 1;
  if (nowEpochSeconds >= times[lastIndex]) {
    const previousIndex = lastIndex - 1;
    return {
      latitude: latitudes[lastIndex],
      longitude: longitudes[lastIndex],
      bearing: computeBearing(
        latitudes[previousIndex],
        longitudes[previousIndex],
        latitudes[lastIndex],
        longitudes[lastIndex]
      ),
      speedMetersPerSecond: 0,
    };
  }

  const nextIndex = Math.max(1, firstIndexAtOrAfter(times, nowEpochSeconds));
  const previousIndex = nextIndex - 1;
  const duration = times[nextIndex] - times[previousIndex];
  const progress = duration > 0 ? (nowEpochSeconds - times[previousIndex]) / duration : 0;
  const legMeters = approxDistanceMeters(
    latitudes[previousIndex],
    longitudes[previousIndex],
    latitudes[nextIndex],
    longitudes[nextIndex]
  );

  return {
    latitude:
      latitudes[previousIndex] + (latitudes[nextIndex] - latitudes[previousIndex]) * progress,
    longitude:
      longitudes[previousIndex] + (longitudes[nextIndex] - longitudes[previousIndex]) * progress,
    bearing: computeBearing(
      latitudes[previousIndex],
      longitudes[previousIndex],
      latitudes[nextIndex],
      longitudes[nextIndex]
    ),
    speedMetersPerSecond: duration > 0 ? legMeters / duration : 0,
  };
};
