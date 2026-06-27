import type GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { DateTime } from "luxon";
import type { TrainPosition } from "../../types/train/train";
import { isExcludedTrainRouteId } from "../excludedTrainRoutes";

type DecodedFeed = ReturnType<typeof GtfsRealtimeBindings.transit_realtime.FeedMessage.decode>;

export const toTrainPositions = (feed: DecodedFeed): TrainPosition[] => {
  const positions: TrainPosition[] = [];
  const now = DateTime.now().toMillis() / 1000;

  for (const entity of feed.entity ?? []) {
    const vehicle = entity.vehicle;
    const position = vehicle?.position;
    if (!vehicle || !position) {
      continue;
    }

    const vehicleTimestamp = vehicle.timestamp == null ? null : Number(vehicle.timestamp);
    if (vehicleTimestamp == null) {
      continue;
    }

    const ageMs = now - vehicleTimestamp;
    if (ageMs > 5 * 60) {
      continue;
    }

    const routeId = vehicle.trip?.routeId ?? "";
    if (!routeId || isExcludedTrainRouteId(routeId)) {
      continue;
    }

    const rawBearing = position.bearing;
    const bearing =
      rawBearing != null && Number.isFinite(Number(rawBearing))
        ? ((Number(rawBearing) % 360) + 360) % 360
        : null;

    const rawSpeed = position.speed;
    const speed = rawSpeed != null && Number.isFinite(Number(rawSpeed)) ? Number(rawSpeed) : null;

    const rawSeq = vehicle.currentStopSequence;
    const currentStopSequence =
      rawSeq != null && Number.isFinite(Number(rawSeq)) && Number(rawSeq) > 0
        ? Math.trunc(Number(rawSeq))
        : null;

    positions.push({
      tripId: vehicle.trip?.tripId ?? "",
      routeId,
      vehicleId: vehicle.vehicle?.id ?? "",
      vehicleLabel: vehicle.vehicle?.label ?? "",
      latitude: position.latitude ?? 0,
      longitude: position.longitude ?? 0,
      timestamp: vehicle.timestamp == null ? null : Number(vehicle.timestamp),
      bearing,
      speed,
      currentStopSequence,
    });
  }

  return positions;
};
