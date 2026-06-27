import { effectiveStopTimeEpoch } from "@/lib/timetableStopMoments";
import { computeBearing } from "@/lib/trainBearing";
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

const isFiniteNumber = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

type TrackPoint = {
  longitude: number;
  latitude: number;
  distanceMeters: number;
};

type TrackPath = {
  points: TrackPoint[];
};

type ProjectedWaypoint = {
  epochSeconds: number;
  distanceMeters: number;
};

type TrackProjection = {
  distanceMeters: number;
  distanceSq: number;
};

const stopArrivalEpoch = (stop: TimetableStop): number | null =>
  effectiveStopTimeEpoch(
    stop.realtimeArrivalTimestamp,
    stop.scheduledArrivalTimestamp,
    stop.arrivalDelaySeconds
  );

const stopDepartureEpoch = (stop: TimetableStop): number | null =>
  effectiveStopTimeEpoch(
    stop.realtimeDepartureTimestamp,
    stop.scheduledDepartureTimestamp,
    stop.departureDelaySeconds
  );

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

const approxDistanceMeters = (
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number
): number => {
  const dy = (toLatitude - fromLatitude) * 111_000;
  const cosLat = Math.cos((fromLatitude * Math.PI) / 180);
  const dx = (toLongitude - fromLongitude) * 111_000 * cosLat;
  return Math.hypot(dx, dy);
};

const buildTrackPath = (coordinates: TrainTrackCoordinate[]): TrackPath | null => {
  if (coordinates.length < 2) {
    return null;
  }

  const points: TrackPoint[] = [];
  let distanceMeters = 0;

  for (let index = 0; index < coordinates.length; index++) {
    const [longitude, latitude] = coordinates[index];
    if (index > 0) {
      const previous = points[index - 1];
      distanceMeters += approxDistanceMeters(
        previous.latitude,
        previous.longitude,
        latitude,
        longitude
      );
    }
    points.push({ longitude, latitude, distanceMeters });
  }

  return { points };
};

const projectWaypointToPath = (
  path: TrackPath,
  waypoint: Pick<TrainAnimationWaypoint, "latitude" | "longitude">
): TrackProjection | null => {
  let bestProjection: TrackProjection | null = null;

  for (let index = 0; index < path.points.length - 1; index++) {
    const start = path.points[index];
    const end = path.points[index + 1];
    const cosLat = Math.cos((waypoint.latitude * Math.PI) / 180);
    const ax = start.longitude * 111_000 * cosLat;
    const ay = start.latitude * 111_000;
    const bx = end.longitude * 111_000 * cosLat;
    const by = end.latitude * 111_000;
    const px = waypoint.longitude * 111_000 * cosLat;
    const py = waypoint.latitude * 111_000;
    const dx = bx - ax;
    const dy = by - ay;
    const segmentLengthSq = dx * dx + dy * dy;
    if (segmentLengthSq === 0) continue;

    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / segmentLengthSq));
    const distanceSq = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
    const segmentDistance = end.distanceMeters - start.distanceMeters;
    const distanceMeters = start.distanceMeters + segmentDistance * t;

    if (bestProjection == null || distanceSq < bestProjection.distanceSq) {
      bestProjection = { distanceMeters, distanceSq };
    }
  }

  return bestProjection;
};

const selectRouteTrackPath = (
  tracks: TrainTracksResponse,
  routeId: string,
  waypoints: TrainAnimationWaypoint[]
): TrackPath | null => {
  const routePaths = tracks.features
    .filter((feature) => feature.properties.route_id === routeId)
    .map((feature) => buildTrackPath(feature.geometry.coordinates))
    .filter((path): path is TrackPath => path != null);

  if (routePaths.length === 0) {
    return null;
  }

  const scoringWaypoints = waypoints.length > 0 ? waypoints : [];
  if (scoringWaypoints.length === 0) {
    return routePaths[0];
  }

  let bestPath = routePaths[0];
  let bestScore = Infinity;

  for (const path of routePaths) {
    const score = scoringWaypoints.reduce((total, waypoint) => {
      const projection = projectWaypointToPath(path, waypoint);
      return total + (projection?.distanceSq ?? Number.MAX_SAFE_INTEGER);
    }, 0);

    if (score < bestScore) {
      bestPath = path;
      bestScore = score;
    }
  }

  return bestPath;
};

const samplePathAtDistance = (
  path: TrackPath,
  distanceMeters: number,
  directionMeters: number,
  speedMetersPerSecond: number
): InterpolatedTrainPosition | null => {
  if (path.points.length === 0) {
    return null;
  }

  if (path.points.length === 1 || distanceMeters <= path.points[0].distanceMeters) {
    const first = path.points[0];
    const next = path.points[1] ?? first;
    const bearing = computeBearing(first.latitude, first.longitude, next.latitude, next.longitude);
    return {
      latitude: first.latitude,
      longitude: first.longitude,
      bearing: directionMeters < 0 ? (bearing + 180) % 360 : bearing,
      speedMetersPerSecond,
    };
  }

  const last = path.points[path.points.length - 1];
  if (distanceMeters >= last.distanceMeters) {
    const previous = path.points[path.points.length - 2] ?? last;
    const bearing = computeBearing(
      previous.latitude,
      previous.longitude,
      last.latitude,
      last.longitude
    );
    return {
      latitude: last.latitude,
      longitude: last.longitude,
      bearing: directionMeters < 0 ? (bearing + 180) % 360 : bearing,
      speedMetersPerSecond,
    };
  }

  const nextIndex = path.points.findIndex((point) => point.distanceMeters >= distanceMeters);
  const next = path.points[nextIndex];
  const previous = path.points[nextIndex - 1];
  const segmentDistance = next.distanceMeters - previous.distanceMeters;
  const progress =
    segmentDistance > 0 ? (distanceMeters - previous.distanceMeters) / segmentDistance : 0;
  const bearing = computeBearing(
    previous.latitude,
    previous.longitude,
    next.latitude,
    next.longitude
  );

  return {
    latitude: previous.latitude + (next.latitude - previous.latitude) * progress,
    longitude: previous.longitude + (next.longitude - previous.longitude) * progress,
    bearing: directionMeters < 0 ? (bearing + 180) % 360 : bearing,
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
    }
  }

  stopWaypoints.sort((a, b) => a.epochSeconds - b.epochSeconds);

  return stopWaypoints.filter(
    (waypoint, index, waypoints) =>
      index === waypoints.length - 1 || waypoint.epochSeconds !== waypoints[index + 1].epochSeconds
  );
};

export const interpolatePosition = (
  waypoints: TrainAnimationWaypoint[],
  nowEpochSeconds: number,
  tracks?: TrainTracksResponse,
  routeId?: string
): InterpolatedTrainPosition | null => {
  if (waypoints.length === 0) {
    return null;
  }

  if (tracks != null && routeId != null) {
    const trackPosition = interpolatePositionAlongTrack(
      waypoints,
      nowEpochSeconds,
      tracks,
      routeId
    );
    if (trackPosition != null) {
      return trackPosition;
    }
  }

  if (waypoints.length === 1 || nowEpochSeconds <= waypoints[0].epochSeconds) {
    const first = waypoints[0];
    const next = waypoints[1] ?? first;
    return {
      latitude: first.latitude,
      longitude: first.longitude,
      bearing: computeBearing(first.latitude, first.longitude, next.latitude, next.longitude),
      speedMetersPerSecond: 0,
    };
  }

  const last = waypoints[waypoints.length - 1];
  if (nowEpochSeconds >= last.epochSeconds) {
    const previous = waypoints[waypoints.length - 2] ?? last;
    return {
      latitude: last.latitude,
      longitude: last.longitude,
      bearing: computeBearing(previous.latitude, previous.longitude, last.latitude, last.longitude),
      speedMetersPerSecond: 0,
    };
  }

  const nextIndex = waypoints.findIndex((waypoint) => waypoint.epochSeconds >= nowEpochSeconds);
  const next = waypoints[nextIndex];
  const previous = waypoints[nextIndex - 1];
  const durationSeconds = next.epochSeconds - previous.epochSeconds;
  const progress =
    durationSeconds > 0 ? (nowEpochSeconds - previous.epochSeconds) / durationSeconds : 0;
  const legDistanceMeters = approxDistanceMeters(
    previous.latitude,
    previous.longitude,
    next.latitude,
    next.longitude
  );
  const speedMetersPerSecond = durationSeconds > 0 ? legDistanceMeters / durationSeconds : 0;

  return {
    latitude: previous.latitude + (next.latitude - previous.latitude) * progress,
    longitude: previous.longitude + (next.longitude - previous.longitude) * progress,
    bearing: computeBearing(previous.latitude, previous.longitude, next.latitude, next.longitude),
    speedMetersPerSecond,
  };
};

const interpolatePositionAlongTrack = (
  waypoints: TrainAnimationWaypoint[],
  nowEpochSeconds: number,
  tracks: TrainTracksResponse,
  routeId: string
): InterpolatedTrainPosition | null => {
  const path = selectRouteTrackPath(tracks, routeId, waypoints);
  if (path == null) {
    return null;
  }

  const projectedWaypoints = waypoints
    .flatMap<ProjectedWaypoint>((waypoint) => {
      const projection = projectWaypointToPath(path, waypoint);
      if (projection == null) return [];
      return [{ epochSeconds: waypoint.epochSeconds, distanceMeters: projection.distanceMeters }];
    })
    .filter(
      (waypoint, index, projected) =>
        index === projected.length - 1 ||
        waypoint.epochSeconds !== projected[index + 1].epochSeconds
    );

  if (projectedWaypoints.length === 0) {
    return null;
  }

  if (projectedWaypoints.length === 1 || nowEpochSeconds <= projectedWaypoints[0].epochSeconds) {
    const first = projectedWaypoints[0];
    const next = projectedWaypoints[1] ?? first;
    const durationSeconds = Math.max(0, next.epochSeconds - first.epochSeconds);
    const legDistanceMeters = Math.abs(next.distanceMeters - first.distanceMeters);
    const speedMetersPerSecond = durationSeconds > 0 ? legDistanceMeters / durationSeconds : 0;
    return samplePathAtDistance(
      path,
      first.distanceMeters,
      next.distanceMeters - first.distanceMeters,
      speedMetersPerSecond
    );
  }

  const last = projectedWaypoints[projectedWaypoints.length - 1];
  if (nowEpochSeconds >= last.epochSeconds) {
    const previous = projectedWaypoints[projectedWaypoints.length - 2] ?? last;
    const durationSeconds = Math.max(0, last.epochSeconds - previous.epochSeconds);
    const legDistanceMeters = Math.abs(last.distanceMeters - previous.distanceMeters);
    const speedMetersPerSecond = durationSeconds > 0 ? legDistanceMeters / durationSeconds : 0;
    return samplePathAtDistance(
      path,
      last.distanceMeters,
      last.distanceMeters - previous.distanceMeters,
      speedMetersPerSecond
    );
  }

  const nextIndex = projectedWaypoints.findIndex(
    (waypoint) => waypoint.epochSeconds >= nowEpochSeconds
  );
  const next = projectedWaypoints[nextIndex];
  const previous = projectedWaypoints[nextIndex - 1];
  const durationSeconds = next.epochSeconds - previous.epochSeconds;
  const progress =
    durationSeconds > 0 ? (nowEpochSeconds - previous.epochSeconds) / durationSeconds : 0;
  const distanceMeters =
    previous.distanceMeters + (next.distanceMeters - previous.distanceMeters) * progress;
  const legDistanceMeters = Math.abs(next.distanceMeters - previous.distanceMeters);
  const speedMetersPerSecond = durationSeconds > 0 ? legDistanceMeters / durationSeconds : 0;

  return samplePathAtDistance(
    path,
    distanceMeters,
    next.distanceMeters - previous.distanceMeters,
    speedMetersPerSecond
  );
};
