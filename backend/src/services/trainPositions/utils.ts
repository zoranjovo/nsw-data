import { DateTime } from "luxon";
import type { TrainPosition } from "../../types/train/train";
import { type DecodedFeed, optionalField } from "../gtfsRealtime";
import type { TfnswVehicleExtension } from "./tfnswExtensions";

type TripSetInfo = {
  setType: string | null;
  carCount: number | null;
};

// <trip_name>.<timetable_id>.<timetable_version_id>.<dop_ref>.<set_type>.<number_of_cars>.<trip_instance>
export const parseTripSetInfo = (tripId: string): TripSetInfo => {
  const parts = tripId.split(".");
  if (parts.length !== 7) {
    return { setType: null, carCount: null };
  }

  const setType = /^[A-Z]$/.test(parts[4]) ? parts[4] : null;
  const carCount = Number(parts[5]);
  return {
    setType,
    carCount: Number.isInteger(carCount) && carCount > 0 ? carCount : null,
  };
};

export const toTrainPositions = (
  feed: DecodedFeed,
  extensionsByEntityId: Map<string, TfnswVehicleExtension> = new Map()
): TrainPosition[] => {
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
    if (!routeId) {
      continue;
    }

    const rawBearing = optionalField(position, "bearing");
    const bearing =
      rawBearing != null && Number.isFinite(Number(rawBearing))
        ? ((Number(rawBearing) % 360) + 360) % 360
        : null;

    const rawSpeed = optionalField(position, "speed");
    const speed = rawSpeed != null && Number.isFinite(Number(rawSpeed)) ? Number(rawSpeed) : null;

    const rawSeq = vehicle.currentStopSequence;
    const currentStopSequence =
      rawSeq != null && Number.isFinite(Number(rawSeq)) && Number(rawSeq) > 0
        ? Math.trunc(Number(rawSeq))
        : null;

    const tripId = vehicle.trip?.tripId ?? "";
    const tripSetInfo = parseTripSetInfo(tripId);
    const extension = extensionsByEntityId.get(entity.id);

    positions.push({
      tripId,
      routeId,
      vehicleId: vehicle.vehicle?.id ?? "",
      vehicleLabel: vehicle.vehicle?.label ?? "",
      latitude: position.latitude ?? 0,
      longitude: position.longitude ?? 0,
      timestamp: vehicle.timestamp == null ? null : Number(vehicle.timestamp),
      bearing,
      speed,
      currentStopSequence,
      fleetCode: extension?.vehicleModel ?? tripSetInfo.setType,
      carCount: extension?.carriageCount || tripSetInfo.carCount,
    });
  }

  return positions;
};
