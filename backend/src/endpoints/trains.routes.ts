import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getAlerts } from "../services/alerts/alerts";
import { getRouteStaticAssets } from "../services/staticData/staticData";
import { getTripTimetableByTripId } from "../services/timetable/timetable";
import { getTrainPositionsData } from "../services/trainPositions/trainPositions";
import { getTripUpdatesData } from "../services/tripUpdates/tripUpdates";
import type { TripUpdates, TripUpdatesResponse } from "../types/train/tripUpdates";

export const trainsRouter = Router();
const THIRTY_SECOND_WINDOW_MS = 30_000;

const createRateLimiter = (max: number) => {
  return rateLimit({
    windowMs: THIRTY_SECOND_WINDOW_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      return res.status(429).json({ error: "Rate limited" });
    },
  });
};

const tracksRateLimiter = createRateLimiter(10);
const stopsRateLimiter = createRateLimiter(10);
const realtimeRateLimiter = createRateLimiter(30);
const alertsRateLimiter = createRateLimiter(30);
const timetableSingleRateLimiter = createRateLimiter(20);
const timetableBulkRateLimiter = createRateLimiter(10);

const toTripUpdatesResponse = (tripUpdates: TripUpdates): TripUpdatesResponse => {
  return {
    fetchedAt: tripUpdates.fetchedAt,
    items: tripUpdates.items.map((entry) => ({
      tripId: entry.tripId,
      routeId: entry.routeId,
      vehicleId: entry.vehicleId,
      stopTimeUpdates: entry.stopTimeUpdates.map((stop) => ({
        stopId: stop.stopId,
        arrivalDelaySeconds: stop.arrivalDelaySeconds,
        departureDelaySeconds: stop.departureDelaySeconds,
      })),
    })),
  };
};

trainsRouter.get("/tracks", tracksRateLimiter, async (_req, res) => {
  try {
    const { tracks } = await getRouteStaticAssets();
    return res.json(tracks);
  } catch (error) {
    console.error("Error returning tracks:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

trainsRouter.get("/stops", stopsRateLimiter, async (req, res) => {
  try {
    const { stops } = await getRouteStaticAssets();
    const includePlatforms = req.query.includePlatforms === "true";
    if (includePlatforms) {
      return res.json(stops);
    } else {
      return res.json(
        stops.filter((stop) => stop.stopName?.toLowerCase().includes("platform") === false)
      );
    }
  } catch (error) {
    console.error("Error returning stops:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

trainsRouter.get("/realtime", realtimeRateLimiter, async (_req, res) => {
  try {
    const [positions, tripUpdates] = await Promise.all([
      getTrainPositionsData(),
      getTripUpdatesData(),
    ]);
    return res.json({ positions, tripUpdates: toTripUpdatesResponse(tripUpdates) });
  } catch (error) {
    console.error("Error fetching realtime data:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

trainsRouter.get("/alerts", alertsRateLimiter, async (_req, res) => {
  try {
    const { alerts, fetchedAt } = await getAlerts();
    return res.json({ alerts, fetchedAt });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

trainsRouter.get("/timetable/:tripId", timetableSingleRateLimiter, async (req, res) => {
  try {
    const timetable = getTripTimetableByTripId(req.params.tripId);
    if (!timetable) {
      return res.status(404).json({ error: "Timetable not found" });
    }
    return res.json(timetable);
  } catch (error) {
    console.error("Error fetching timetable:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

trainsRouter.post("/timetable/bulk", timetableBulkRateLimiter, async (req, res) => {
  try {
    const { tripIds } = req.body as { tripIds: string[] };
    const timetables = tripIds.map(getTripTimetableByTripId);
    return res.json(timetables);
  } catch (error) {
    console.error("Error fetching timetables:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});
