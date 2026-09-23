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
};

/** Precomputed geometry for one trip, sampled cheaply on every animation frame. */
export type TrainMotion = {
  times: Float64Array;
  path: TrackPath | null;
  distances: Float64Array | null;
  direction: number;
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

const CANDIDATE_RADIUS_METERS = 300;
const PASS_GAP_METERS = 2 * CANDIDATE_RADIUS_METERS;
const BACKTRACK_TOLERANCE_METERS = 50;
const STATION_RADIUS_METERS = 150;
const MAX_FIX_DELAY_SECONDS = 30 * 60;

type TrackProjection = {
  distanceMeters: number;
  offsetSq: number;
};

type TrackFit = {
  distances: Float64Array;
  direction: number;
  cost: number;
};

const projectionCandidates = (
  path: TrackPath,
  latitude: number,
  longitude: number
): TrackProjection[] => {
  const px = longitude * METERS_PER_DEGREE * path.cosLat;
  const py = latitude * METERS_PER_DEGREE;
  const radiusSq = CANDIDATE_RADIUS_METERS * CANDIDATE_RADIUS_METERS;
  const hits: TrackProjection[] = [];

  for (let chunk = 0; chunk < path.chunkMinX.length; chunk++) {
    const minX = path.chunkMinX[chunk];
    const maxX = path.chunkMaxX[chunk];
    const minY = path.chunkMinY[chunk];
    const maxY = path.chunkMaxY[chunk];
    const gapX = px < minX ? minX - px : px > maxX ? px - maxX : 0;
    const gapY = py < minY ? minY - py : py > maxY ? py - maxY : 0;
    if (gapX * gapX + gapY * gapY > radiusSq) continue;

    const startIndex = chunk * SEGMENTS_PER_CHUNK;
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
      const offsetSq = offsetX * offsetX + offsetY * offsetY;
      if (offsetSq <= radiusSq) {
        hits.push({
          distanceMeters: path.dists[index] + (path.dists[index + 1] - path.dists[index]) * t,
          offsetSq,
        });
      }
    }
  }

  hits.sort((a, b) => a.distanceMeters - b.distanceMeters);
  const passes: TrackProjection[] = [];
  let passEnd = -Infinity;
  for (const hit of hits) {
    const lastIndex = passes.length - 1;
    if (lastIndex >= 0 && hit.distanceMeters - passEnd <= PASS_GAP_METERS) {
      if (hit.offsetSq < passes[lastIndex].offsetSq) passes[lastIndex] = hit;
    } else {
      passes.push(hit);
    }
    passEnd = hit.distanceMeters;
  }
  return passes;
};

const fitAlongTrack = (candidates: TrackProjection[][], direction: number): TrackFit | null => {
  const costs = candidates.map((options) => options.map(() => Infinity));
  const previous = candidates.map((options) => options.map(() => -1));
  for (const [option, candidate] of candidates[0].entries()) {
    costs[0][option] = candidate.offsetSq;
  }
  for (let index = 1; index < candidates.length; index++) {
    for (const [option, candidate] of candidates[index].entries()) {
      for (const [priorOption, prior] of candidates[index - 1].entries()) {
        const progress = direction * (candidate.distanceMeters - prior.distanceMeters);
        const cost = costs[index - 1][priorOption] + candidate.offsetSq;
        if (progress >= -BACKTRACK_TOLERANCE_METERS && cost < costs[index][option]) {
          costs[index][option] = cost;
          previous[index][option] = priorOption;
        }
      }
    }
  }

  const lastCosts = costs[costs.length - 1];
  const bestCost = Math.min(...lastCosts);
  if (!Number.isFinite(bestCost)) {
    return null;
  }

  const distances = new Float64Array(candidates.length);
  let option = lastCosts.indexOf(bestCost);
  for (let index = candidates.length - 1; index >= 0; index--) {
    distances[index] = candidates[index][option].distanceMeters;
    option = previous[index][option];
  }
  for (let index = 1; index < distances.length; index++) {
    if (direction * (distances[index] - distances[index - 1]) < 0) {
      distances[index] = distances[index - 1];
    }
  }
  return { distances, direction, cost: bestCost };
};

const scheduledEpochAtDistance = (
  times: Float64Array,
  distances: Float64Array,
  direction: number,
  distanceMeters: number,
  fixEpochSeconds: number
): number => {
  const lastIndex = distances.length - 1;
  let stationStart = -1;
  let stationEnd = -1;
  for (let index = 0; index <= lastIndex; index++) {
    if (Math.abs(distances[index] - distanceMeters) <= STATION_RADIUS_METERS) {
      if (stationStart === -1) stationStart = index;
      stationEnd = index;
    }
  }
  if (stationStart !== -1) {
    return Math.min(Math.max(fixEpochSeconds, times[stationStart]), times[stationEnd]);
  }

  const target = direction * distanceMeters;
  if (target <= direction * distances[0]) {
    return Math.min(fixEpochSeconds, times[0]);
  }
  if (target >= direction * distances[lastIndex]) {
    return Math.max(fixEpochSeconds, times[lastIndex]);
  }
  let next = 1;
  while (direction * distances[next] < target) next++;
  const legStart = direction * distances[next - 1];
  const legMeters = direction * distances[next] - legStart;
  return times[next - 1] + ((times[next] - times[next - 1]) * (target - legStart)) / legMeters;
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

const applyGpsFix = (
  path: TrackPath,
  times: Float64Array,
  distances: Float64Array,
  direction: number,
  gpsPosition: TrainPosition
): TrainMotion | null => {
  const fixEpochSeconds = gpsPosition.timestamp;
  if (
    fixEpochSeconds == null ||
    !isFiniteNumber(gpsPosition.latitude) ||
    !isFiniteNumber(gpsPosition.longitude)
  ) {
    return null;
  }

  let fixDistance: number | null = null;
  let fixScheduledEpoch = 0;
  for (const candidate of projectionCandidates(path, gpsPosition.latitude, gpsPosition.longitude)) {
    const scheduledEpoch = scheduledEpochAtDistance(
      times,
      distances,
      direction,
      candidate.distanceMeters,
      fixEpochSeconds
    );
    if (
      fixDistance == null ||
      Math.abs(fixEpochSeconds - scheduledEpoch) < Math.abs(fixEpochSeconds - fixScheduledEpoch)
    ) {
      fixDistance = candidate.distanceMeters;
      fixScheduledEpoch = scheduledEpoch;
    }
  }
  const delaySeconds = fixEpochSeconds - fixScheduledEpoch;
  if (fixDistance == null || Math.abs(delaySeconds) > MAX_FIX_DELAY_SECONDS) {
    return null;
  }

  const shiftedTimes = [fixEpochSeconds];
  const shiftedDistances = [fixDistance];
  for (let index = 0; index < times.length; index++) {
    if (times[index] <= fixScheduledEpoch) continue;
    const previousDistance = shiftedDistances[shiftedDistances.length - 1];
    shiftedTimes.push(times[index] + delaySeconds);
    shiftedDistances.push(
      direction * (distances[index] - previousDistance) < 0 ? previousDistance : distances[index]
    );
  }

  return {
    times: Float64Array.from(shiftedTimes),
    path,
    distances: Float64Array.from(shiftedDistances),
    direction,
    latitudes: null,
    longitudes: null,
  };
};

const buildTrackMotion = (
  waypoints: TrainAnimationWaypoint[],
  gpsPosition: TrainPosition | null,
  tracks: TrainTracksResponse,
  routeId: string
): TrainMotion | null => {
  let bestPath: TrackPath | null = null;
  let bestFit: TrackFit | null = null;

  for (const path of routeTrackPaths(tracks, routeId)) {
    const candidates = waypoints.map((waypoint) =>
      projectionCandidates(path, waypoint.latitude, waypoint.longitude)
    );
    if (candidates.some((options) => options.length === 0)) continue;
    for (const direction of [1, -1]) {
      const fit = fitAlongTrack(candidates, direction);
      if (fit != null && (bestFit == null || fit.cost < bestFit.cost)) {
        bestPath = path;
        bestFit = fit;
      }
    }
  }

  if (bestPath == null || bestFit == null) {
    return null;
  }

  const times = Float64Array.from(waypoints, (waypoint) => waypoint.epochSeconds);
  const fixedMotion =
    gpsPosition == null
      ? null
      : applyGpsFix(bestPath, times, bestFit.distances, bestFit.direction, gpsPosition);

  return (
    fixedMotion ?? {
      times,
      path: bestPath,
      distances: bestFit.distances,
      direction: bestFit.direction,
      latitudes: null,
      longitudes: null,
    }
  );
};

export const buildTrainMotion = (
  timetable: TimetableData,
  gpsPosition: TrainPosition | null,
  tracks?: TrainTracksResponse,
  routeId?: string
): TrainMotion | null => {
  const stopWaypoints = buildAnimationWaypoints(timetable, null);
  if (stopWaypoints.length === 0) {
    return null;
  }

  if (tracks != null && routeId != null && routeId.length > 0) {
    const trackMotion = buildTrackMotion(stopWaypoints, gpsPosition, tracks, routeId);
    if (trackMotion != null) {
      return trackMotion;
    }
  }

  const waypoints = buildAnimationWaypoints(timetable, gpsPosition);
  const waypointCount = waypoints.length;
  const times = new Float64Array(waypointCount);
  const latitudes = new Float64Array(waypointCount);
  const longitudes = new Float64Array(waypointCount);
  for (let index = 0; index < waypointCount; index++) {
    times[index] = waypoints[index].epochSeconds;
    latitudes[index] = waypoints[index].latitude;
    longitudes[index] = waypoints[index].longitude;
  }

  return { times, path: null, distances: null, direction: 1, latitudes, longitudes };
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
    return samplePathAtDistance(path, distances[0], motion.direction, 0);
  }

  if (nowEpochSeconds <= times[0]) {
    const duration = times[1] - times[0];
    const legMeters = Math.abs(distances[1] - distances[0]);
    return samplePathAtDistance(
      path,
      distances[0],
      distances[1] - distances[0] || motion.direction,
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
      distances[lastIndex] - distances[previousIndex] || motion.direction,
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
    distances[nextIndex] - distances[previousIndex] || motion.direction,
    duration > 0 ? legMeters / duration : 0
  );
};

const movingLegBearing = (
  latitudes: Float64Array,
  longitudes: Float64Array,
  index: number
): number => {
  const isAtIndex = (other: number) =>
    latitudes[other] === latitudes[index] && longitudes[other] === longitudes[index];
  for (let next = index + 1; next < latitudes.length; next++) {
    if (!isAtIndex(next)) {
      return computeBearing(latitudes[index], longitudes[index], latitudes[next], longitudes[next]);
    }
  }
  for (let previous = index - 1; previous >= 0; previous--) {
    if (!isAtIndex(previous)) {
      return computeBearing(
        latitudes[previous],
        longitudes[previous],
        latitudes[index],
        longitudes[index]
      );
    }
  }
  return 0;
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
    return {
      latitude: latitudes[0],
      longitude: longitudes[0],
      bearing: movingLegBearing(latitudes, longitudes, 0),
      speedMetersPerSecond: 0,
    };
  }

  const lastIndex = count - 1;
  if (nowEpochSeconds >= times[lastIndex]) {
    return {
      latitude: latitudes[lastIndex],
      longitude: longitudes[lastIndex],
      bearing: movingLegBearing(latitudes, longitudes, lastIndex),
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
    bearing: movingLegBearing(latitudes, longitudes, previousIndex),
    speedMetersPerSecond: duration > 0 ? legMeters / duration : 0,
  };
};
