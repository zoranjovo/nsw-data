import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import axios from "axios";
import { parse } from "csv-parse";
import { DateTime } from "luxon";
import unzipper from "unzipper";
import type { TrainStopsResponse } from "../../types/train/stops";
import type {
  StaticRoute,
  StaticStop,
  StaticStopTime,
  StaticTrip,
} from "../../types/train/timetable";
import type {
  TrainTrackFeature,
  TrainTrackProperties,
  TrainTracksResponse,
} from "../../types/train/tracks";
import { debugLog } from "../../utils/debug";

const TFNSW_STATIC_TIMETABLE_URL = "https://api.transport.nsw.gov.au/v1/gtfs/schedule/sydneytrains";

const ASSETS_DIR = resolve(process.cwd(), "temp-assets");
const STATIC_ASSETS_ZONE = "Australia/Sydney";
const STATIC_ASSETS_META_FILE = "static-assets-meta.json";

const REQUIRED_ASSET_FILES = [
  "stops.json",
  "routes.json",
  "trips.json",
  "stopTimes.json",
  "tracks.json",
] as const;

type CsvRecord = Record<string, string | undefined>;

type ShapePoint = {
  shapeId: string;
  latitude: number;
  longitude: number;
  sequence: number;
  distanceTraveled: number | null;
};

type RouteMeta = {
  routeId: string;
  agencyId: string;
  routeShortName: string;
  routeLongName: string;
  routeDesc: string;
  routeType: string;
  routeColor: string;
  routeTextColor: string;
};

type TripShape = {
  routeId: string;
  shapeId: string;
};

type ParsedGtfs = {
  stops: StaticStop[];
  routes: StaticRoute[];
  trips: StaticTrip[];
  stopTimes: StaticStopTime[];
  shapes: ShapePoint[];
  routeMetaById: Map<string, RouteMeta>;
  tripShapes: TripShape[];
};

let routeAssetsCache: {
  sourceKey: string;
  stops: TrainStopsResponse;
  tracks: TrainTracksResponse;
} | null = null;

type StaticAssetsMeta = {
  fetchedDate: string;
};

let refreshNewDayInFlight: Promise<boolean> | null = null;

const sydneyTodayIsoDate = (): string => {
  return DateTime.now().setZone(STATIC_ASSETS_ZONE).toISODate() ?? "";
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const parseStaticAssetsMeta = (raw: unknown): StaticAssetsMeta | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const fetchedDate = (raw as { fetchedDate?: unknown }).fetchedDate;
  if (typeof fetchedDate !== "string" || !ISO_DATE_RE.test(fetchedDate)) {
    return null;
  }
  return { fetchedDate };
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const readStaticAssetsMeta = async (assetDir: string): Promise<StaticAssetsMeta | null> => {
  const metaPath = resolve(assetDir, STATIC_ASSETS_META_FILE);
  try {
    const content = await readFile(metaPath, "utf8");
    return parseStaticAssetsMeta(JSON.parse(content) as unknown);
  } catch {
    return null;
  }
};

const writeStaticAssetsMeta = async (assetDir: string, fetchedDate: string): Promise<void> => {
  await mkdir(assetDir, { recursive: true });
  const meta: StaticAssetsMeta = { fetchedDate };
  await writeFile(resolve(assetDir, STATIC_ASSETS_META_FILE), JSON.stringify(meta), "utf8");
};

const allRequiredAssetFilesExist = async (assetDir: string): Promise<boolean> => {
  const results = await Promise.all(
    REQUIRED_ASSET_FILES.map((fileName) => fileExists(resolve(assetDir, fileName)))
  );
  return results.every(Boolean);
};

const ensureStaticAssetsMetaForMigration = async (assetDir: string): Promise<void> => {
  const existing = await readStaticAssetsMeta(assetDir);
  if (existing) {
    return;
  }
  if (!(await allRequiredAssetFilesExist(assetDir))) {
    return;
  }
  const today = sydneyTodayIsoDate();
  await writeStaticAssetsMeta(assetDir, today);
  debugLog("STATIC", `wrote migration static assets meta fetchedDate=${today}`);
};

const parseNumber = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

const parseRequiredInt = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const next = Number.parseInt(value, 10);
  return Number.isFinite(next) ? next : null;
};

const parseGtfsTime = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const match = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
};

const normalizeHexColor = (value: string | undefined): string => {
  const trimmed = value?.trim() ?? "";
  return trimmed.replace(/^#/, "");
};

const toRouteTypeText = (routeType: string): string => {
  switch (routeType) {
    case "0":
      return "Tram";
    case "1":
      return "Subway";
    case "2":
      return "Rail";
    case "3":
      return "Bus";
    case "4":
      return "Ferry";
    case "5":
      return "Cable tram";
    case "6":
      return "Aerial lift";
    case "7":
      return "Funicular";
    case "11":
      return "Trolleybus";
    case "12":
      return "Monorail";
    default:
      return "Unknown";
  }
};

const consumeCsv = async (
  stream: NodeJS.ReadableStream,
  onRecord: (record: CsvRecord) => void | Promise<void>
): Promise<void> => {
  const parser = stream.pipe(
    parse({
      columns: true,
      trim: true,
      bom: true,
      skip_empty_lines: true,
    })
  );

  for await (const record of parser as AsyncIterable<CsvRecord>) {
    await onRecord(record);
  }
};

const parseGtfsZip = async (stream: NodeJS.ReadableStream): Promise<ParsedGtfs> => {
  const zipEntries = new Set([
    "routes.txt",
    "stop_times.txt",
    "stops.txt",
    "trips.txt",
    "shapes.txt",
  ]);
  const stops: StaticStop[] = [];
  const routes: StaticRoute[] = [];
  const trips: StaticTrip[] = [];
  const stopTimes: StaticStopTime[] = [];
  const shapes: ShapePoint[] = [];
  const routeMetaById = new Map<string, RouteMeta>();
  const tripShapes: TripShape[] = [];

  const zipStream = stream.pipe(unzipper.Parse({ forceStream: true }));
  for await (const entry of zipStream as AsyncIterable<unzipper.Entry>) {
    const fileName = entry.path.split("/").pop()?.toLowerCase() ?? "";
    if (!zipEntries.has(fileName)) {
      entry.autodrain();
      continue;
    }

    if (fileName === "stops.txt") {
      await consumeCsv(entry, (record) => {
        const stopId = record.stop_id?.trim();
        if (!stopId) {
          return;
        }
        stops.push({
          stopId,
          stopName: record.stop_name?.trim() || null,
          latitude: parseNumber(record.stop_lat),
          longitude: parseNumber(record.stop_lon),
        });
      });
      continue;
    }

    if (fileName === "routes.txt") {
      await consumeCsv(entry, (record) => {
        const routeId = record.route_id?.trim();
        if (!routeId) {
          return;
        }
        routes.push({
          routeId,
          routeShortName: record.route_short_name?.trim() || null,
          routeLongName: record.route_long_name?.trim() || null,
        });
        routeMetaById.set(routeId, {
          routeId,
          agencyId: record.agency_id?.trim() || "",
          routeShortName: record.route_short_name?.trim() || "",
          routeLongName: record.route_long_name?.trim() || "",
          routeDesc: record.route_desc?.trim() || "",
          routeType: record.route_type?.trim() || "",
          routeColor: normalizeHexColor(record.route_color),
          routeTextColor: normalizeHexColor(record.route_text_color),
        });
      });
      continue;
    }

    if (fileName === "trips.txt") {
      await consumeCsv(entry, (record) => {
        const tripId = record.trip_id?.trim();
        const routeId = record.route_id?.trim();
        if (!tripId || !routeId) {
          return;
        }
        trips.push({
          tripId,
          routeId,
          serviceId: record.service_id?.trim() || null,
          tripHeadsign: record.trip_headsign?.trim() || null,
        });
        const shapeId = record.shape_id?.trim();
        if (shapeId) {
          tripShapes.push({ routeId, shapeId });
        }
      });
      continue;
    }

    if (fileName === "stop_times.txt") {
      await consumeCsv(entry, (record) => {
        const tripId = record.trip_id?.trim();
        const stopId = record.stop_id?.trim();
        const stopSequence = parseRequiredInt(record.stop_sequence);
        if (!tripId || !stopId || stopSequence == null) {
          return;
        }
        stopTimes.push({
          tripId,
          stopId,
          arrivalTime: record.arrival_time?.trim() || null,
          departureTime: record.departure_time?.trim() || null,
          arrivalSeconds: parseGtfsTime(record.arrival_time),
          departureSeconds: parseGtfsTime(record.departure_time),
          stopSequence,
        });
      });
      continue;
    }

    if (fileName === "shapes.txt") {
      await consumeCsv(entry, (record) => {
        const shapeId = record.shape_id?.trim();
        const latitude = parseNumber(record.shape_pt_lat);
        const longitude = parseNumber(record.shape_pt_lon);
        const sequence = parseRequiredInt(record.shape_pt_sequence);
        if (!shapeId || latitude == null || longitude == null || sequence == null) {
          return;
        }
        shapes.push({
          shapeId,
          latitude,
          longitude,
          sequence,
          distanceTraveled: parseNumber(record.shape_dist_traveled),
        });
      });
    }
  }

  stopTimes.sort((a, b) => {
    if (a.tripId === b.tripId) {
      return a.stopSequence - b.stopSequence;
    }
    return a.tripId.localeCompare(b.tripId);
  });

  shapes.sort((a, b) => {
    if (a.shapeId === b.shapeId) {
      return a.sequence - b.sequence;
    }
    return a.shapeId.localeCompare(b.shapeId);
  });

  return { stops, routes, trips, stopTimes, shapes, routeMetaById, tripShapes };
};

const toTracksFeatureCollection = (
  shapes: ShapePoint[],
  routeMetaById: Map<string, RouteMeta>,
  tripShapes: TripShape[]
): TrainTracksResponse => {
  const grouped = new Map<string, ShapePoint[]>();
  for (const point of shapes) {
    const current = grouped.get(point.shapeId);
    if (current) {
      current.push(point);
    } else {
      grouped.set(point.shapeId, [point]);
    }
  }

  const routeCountsByShapeId = new Map<string, Map<string, number>>();
  for (const tripShape of tripShapes) {
    const current = routeCountsByShapeId.get(tripShape.shapeId);
    if (current) {
      current.set(tripShape.routeId, (current.get(tripShape.routeId) ?? 0) + 1);
    } else {
      routeCountsByShapeId.set(tripShape.shapeId, new Map([[tripShape.routeId, 1]]));
    }
  }

  let objectId = 1;
  const features: TrainTrackFeature[] = [];
  for (const [shapeId, points] of grouped) {
    points.sort((a, b) => a.sequence - b.sequence);
    const coordinates = points.map(
      (point) => [point.longitude, point.latitude] as [number, number]
    );
    if (coordinates.length < 2) {
      continue;
    }
    const length = Math.max(...points.map((point) => point.distanceTraveled ?? 0), 0);

    const routeCounts = routeCountsByShapeId.get(shapeId);
    const rankedRouteIds = routeCounts
      ? [...routeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([routeId]) => routeId)
      : [];
    const selectedRouteId = rankedRouteIds.find((routeId) => {
      const routeMeta = routeMetaById.get(routeId);
      return routeMeta?.routeShortName && routeMeta.routeColor;
    });
    if (!selectedRouteId) {
      continue;
    }

    const routeMeta = routeMetaById.get(selectedRouteId);
    if (!routeMeta) {
      continue;
    }

    const properties: TrainTrackProperties = {
      objectid: objectId++,
      shape_id: shapeId,
      route_id: selectedRouteId,
      agency_id: routeMeta.agencyId,
      route_short_name: routeMeta.routeShortName,
      route_long_name: routeMeta.routeLongName,
      route_desc: routeMeta.routeDesc,
      route_type: routeMeta.routeType,
      route_color: routeMeta.routeColor,
      route_text_color: routeMeta.routeTextColor,
      route_type_text: toRouteTypeText(routeMeta.routeType),
      length,
    };

    features.push({
      type: "Feature",
      properties,
      geometry: {
        type: "LineString",
        coordinates,
      },
    });
  }

  return {
    type: "FeatureCollection",
    name: "SydneyTrains",
    features,
  };
};

const readJson = async <T>(filePath: string): Promise<T> => {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as T;
};

const writeJson = async (filePath: string, data: unknown): Promise<void> => {
  await writeFile(filePath, JSON.stringify(data), "utf8");
};

const ensureFilesExist = async (assetDir: string): Promise<void> => {
  const results = await Promise.all(
    REQUIRED_ASSET_FILES.map(async (fileName) => {
      const exists = await fileExists(resolve(assetDir, fileName));
      return { fileName, exists };
    })
  );
  const missing = results.filter((entry) => !entry.exists).map((entry) => entry.fileName);
  if (missing.length > 0) {
    throw new Error(`Missing required static asset files in ${assetDir}: ${missing.join(", ")}`);
  }
};

const downloadAndSaveAssets = async (assetDir: string): Promise<void> => {
  const apiKey = process.env.OPEN_DATA_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPEN_DATA_KEY is required to download static assets");
  }

  debugLog("STATIC", `downloading GTFS static data from ${TFNSW_STATIC_TIMETABLE_URL}`);
  const response = await axios.get<NodeJS.ReadableStream>(TFNSW_STATIC_TIMETABLE_URL, {
    responseType: "stream",
    headers: {
      Authorization: `apikey ${apiKey}`,
      Accept: "application/zip",
    },
  });

  const parsed = await parseGtfsZip(response.data);
  const tracks = toTracksFeatureCollection(parsed.shapes, parsed.routeMetaById, parsed.tripShapes);
  await mkdir(assetDir, { recursive: true });

  await Promise.all([
    writeJson(resolve(assetDir, "stops.json"), parsed.stops),
    writeJson(resolve(assetDir, "routes.json"), parsed.routes),
    writeJson(resolve(assetDir, "trips.json"), parsed.trips),
    writeJson(resolve(assetDir, "stopTimes.json"), parsed.stopTimes),
    writeJson(resolve(assetDir, "tracks.json"), tracks),
  ]);

  await writeStaticAssetsMeta(assetDir, sydneyTodayIsoDate());

  debugLog(
    "STATIC",
    `saved static assets dir=${assetDir} stops=${parsed.stops.length} routes=${parsed.routes.length} trips=${parsed.trips.length} stopTimes=${parsed.stopTimes.length} tracks=${tracks.features.length}`
  );
};

const clearRouteAssetsCache = (): void => {
  routeAssetsCache = null;
};

export const getStaticAssetsDir = (): string => {
  return ASSETS_DIR;
};

const readAssetDirEntries = async (assetDir: string): Promise<string[]> => {
  try {
    return await readdir(assetDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

export const checkStaticAssets = async (): Promise<void> => {
  const assetDir = getStaticAssetsDir();
  const currentEntries = await readAssetDirEntries(assetDir);
  debugLog(
    "STATIC",
    `checking static assets dir=${assetDir} files=${currentEntries.length}${
      currentEntries.length ? ` (${currentEntries.join(", ")})` : ""
    }`
  );

  const results = await Promise.all(
    REQUIRED_ASSET_FILES.map(async (fileName) => {
      const exists = await fileExists(resolve(assetDir, fileName));
      return { fileName, exists };
    })
  );
  const missing = results.filter((entry) => !entry.exists).map((entry) => entry.fileName);
  if (missing.length === 0) {
    debugLog("STATIC", `all required static assets already present in ${assetDir}`);
    await ensureStaticAssetsMetaForMigration(assetDir);
    return;
  }

  debugLog("STATIC", `missing static assets (${missing.join(", ")}), downloading fresh files`);
  clearRouteAssetsCache();
  await downloadAndSaveAssets(assetDir);
  await ensureFilesExist(assetDir);
};

export const getRouteStaticAssets = async (): Promise<{
  stops: TrainStopsResponse;
  tracks: TrainTracksResponse;
}> => {
  const assetsDir = getStaticAssetsDir();
  const sourceKey = assetsDir;
  if (routeAssetsCache && routeAssetsCache.sourceKey === sourceKey) {
    return {
      stops: routeAssetsCache.stops,
      tracks: routeAssetsCache.tracks,
    };
  }

  const [stops, tracks] = await Promise.all([
    readJson<TrainStopsResponse>(resolve(assetsDir, "stops.json")),
    readJson<TrainTracksResponse>(resolve(assetsDir, "tracks.json")),
  ]);

  routeAssetsCache = {
    sourceKey,
    stops,
    tracks,
  };

  return { stops, tracks };
};

export const refreshStaticAssetsIfNewCalendarDay = async (): Promise<boolean> => {
  if (refreshNewDayInFlight) {
    return refreshNewDayInFlight;
  }

  refreshNewDayInFlight = (async (): Promise<boolean> => {
    const assetDir = getStaticAssetsDir();
    await ensureStaticAssetsMetaForMigration(assetDir);

    const meta = await readStaticAssetsMeta(assetDir);
    const today = sydneyTodayIsoDate();
    if (!meta || !today) {
      return false;
    }
    if (meta.fetchedDate === today) {
      return false;
    }

    debugLog(
      "STATIC",
      `calendar day changed (${meta.fetchedDate} -> ${today}), re-downloading static assets`
    );
    clearRouteAssetsCache();
    await downloadAndSaveAssets(assetDir);
    await ensureFilesExist(assetDir);
    return true;
  })();

  try {
    return await refreshNewDayInFlight;
  } finally {
    refreshNewDayInFlight = null;
  }
};
