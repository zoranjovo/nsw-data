import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream";
import { pipeline as pipelineAsync } from "node:stream/promises";
import axios from "axios";
import { parse } from "csv-parse";
import { DateTime } from "luxon";
import unzipper from "unzipper";
import type {
  StaticRoute,
  StaticStop,
  StaticStopTime,
  StaticTimetableSnapshot,
  StaticTrip,
} from "../../types/train/timetable";
import type {
  TrainTrackFeature,
  TrainTrackProperties,
  TrainTracksResponse,
} from "../../types/train/tracks";
import { debugLog } from "../../utils/debug";
import { describeError } from "../../utils/errors";
import { getStaticTimetable, setStaticTimetable } from "../timetable/store";

const TFNSW_STATIC_TIMETABLE_URL = "https://api.transport.nsw.gov.au/v1/gtfs/schedule/sydneytrains";
const STATIC_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

const ASSETS_DIR = resolve(process.cwd(), "temp-assets");
const GTFS_ZIP_FILE = "gtfs.zip";
const STATIC_ASSETS_META_FILE = "static-assets-meta.json";
const LEGACY_ASSET_FILES = [
  "stops.json",
  "routes.json",
  "trips.json",
  "stopTimes.json",
  "tracks.json",
];
const STATIC_ASSETS_ZONE = "Australia/Sydney";

type CsvRecord = Record<string, string | undefined>;

type ShapePoint = {
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

type StaticAssetsMeta = {
  fetchedDate: string;
};

let updateInFlight: Promise<void> | null = null;

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

const writeFileAtomic = async (filePath: string, content: string): Promise<void> => {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
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
  const parser = pipeline(
    stream,
    parse({
      columns: true,
      trim: true,
      bom: true,
      skip_empty_lines: true,
    }),
    () => {}
  );

  for await (const record of parser as AsyncIterable<CsvRecord>) {
    await onRecord(record);
  }
};

const toTracksFeatureCollection = (
  shapePointsById: Map<string, ShapePoint[]>,
  routeMetaById: Map<string, RouteMeta>,
  routeCountsByShapeId: Map<string, Map<string, number>>
): TrainTracksResponse => {
  let objectId = 1;
  const features: TrainTrackFeature[] = [];
  for (const [shapeId, points] of shapePointsById) {
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

export const buildStaticSnapshot = async (
  zipPath: string,
  snapshotDate: string
): Promise<StaticTimetableSnapshot> => {
  const directory = await unzipper.Open.file(zipPath);
  const readEntry = async (fileName: string, onRecord: (record: CsvRecord) => void) => {
    const file = directory.files.find(
      (candidate) => candidate.path.split("/").pop()?.toLowerCase() === fileName
    );
    if (!file) {
      throw new Error(`GTFS zip has no ${fileName}`);
    }
    await consumeCsv(file.stream(), onRecord);
  };

  const stopsById = new Map<string, StaticStop>();
  await readEntry("stops.txt", (record) => {
    const stopId = record.stop_id?.trim();
    if (!stopId) {
      return;
    }
    stopsById.set(stopId, {
      stopId,
      stopName: record.stop_name?.trim() || null,
      latitude: parseNumber(record.stop_lat),
      longitude: parseNumber(record.stop_lon),
    });
  });

  const routesById = new Map<string, StaticRoute>();
  const routeMetaById = new Map<string, RouteMeta>();
  await readEntry("routes.txt", (record) => {
    const routeId = record.route_id?.trim();
    if (!routeId) {
      return;
    }
    routesById.set(routeId, {
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

  const tripsById = new Map<string, StaticTrip>();
  const routeCountsByShapeId = new Map<string, Map<string, number>>();
  await readEntry("trips.txt", (record) => {
    const tripId = record.trip_id?.trim();
    const routeId = record.route_id?.trim();
    if (!tripId || !routeId) {
      return;
    }
    tripsById.set(tripId, {
      tripId,
      routeId,
      serviceId: record.service_id?.trim() || null,
      tripHeadsign: record.trip_headsign?.trim() || null,
    });
    const shapeId = record.shape_id?.trim();
    if (shapeId) {
      const routeCounts = routeCountsByShapeId.get(shapeId) ?? new Map<string, number>();
      routeCounts.set(routeId, (routeCounts.get(routeId) ?? 0) + 1);
      routeCountsByShapeId.set(shapeId, routeCounts);
    }
  });

  const stopTimesByTripId = new Map<string, StaticStopTime[]>();
  let stopTimeCount = 0;
  await readEntry("stop_times.txt", (record) => {
    const trip = tripsById.get(record.trip_id?.trim() ?? "");
    const stopId = record.stop_id?.trim();
    const stopSequence = parseRequiredInt(record.stop_sequence);
    if (!trip || !stopId || stopSequence == null) {
      return;
    }
    const stopTime: StaticStopTime = {
      tripId: trip.tripId,
      stopId,
      arrivalTime: record.arrival_time?.trim() || null,
      departureTime: record.departure_time?.trim() || null,
      arrivalSeconds: parseGtfsTime(record.arrival_time),
      departureSeconds: parseGtfsTime(record.departure_time),
      stopSequence,
    };
    const tripStopTimes = stopTimesByTripId.get(trip.tripId);
    if (tripStopTimes) {
      tripStopTimes.push(stopTime);
    } else {
      stopTimesByTripId.set(trip.tripId, [stopTime]);
    }
    stopTimeCount += 1;
  });
  for (const tripStopTimes of stopTimesByTripId.values()) {
    tripStopTimes.sort((a, b) => a.stopSequence - b.stopSequence);
  }

  const shapePointsById = new Map<string, ShapePoint[]>();
  await readEntry("shapes.txt", (record) => {
    const shapeId = record.shape_id?.trim();
    const latitude = parseNumber(record.shape_pt_lat);
    const longitude = parseNumber(record.shape_pt_lon);
    const sequence = parseRequiredInt(record.shape_pt_sequence);
    if (!shapeId || latitude == null || longitude == null || sequence == null) {
      return;
    }
    const point = {
      latitude,
      longitude,
      sequence,
      distanceTraveled: parseNumber(record.shape_dist_traveled),
    };
    const shapePoints = shapePointsById.get(shapeId);
    if (shapePoints) {
      shapePoints.push(point);
    } else {
      shapePointsById.set(shapeId, [point]);
    }
  });
  const tracks = toTracksFeatureCollection(shapePointsById, routeMetaById, routeCountsByShapeId);

  if (
    stopsById.size === 0 ||
    routesById.size === 0 ||
    tripsById.size === 0 ||
    stopTimeCount === 0 ||
    tracks.features.length === 0
  ) {
    throw new Error(
      `GTFS static data looks empty or truncated (stops=${stopsById.size} routes=${routesById.size} trips=${tripsById.size} stopTimes=${stopTimeCount} tracks=${tracks.features.length})`
    );
  }

  debugLog(
    "STATIC",
    `built timetable for ${snapshotDate} stops=${stopsById.size} routes=${routesById.size} trips=${tripsById.size} stopTimes=${stopTimeCount} tracks=${tracks.features.length}`
  );

  return {
    stopsById,
    routesById,
    tripsById,
    stopTimesByTripId,
    stops: [...stopsById.values()],
    tracks,
    snapshotDate,
    fetchedAt: DateTime.now().toMillis(),
  };
};

const downloadGtfsZip = async (targetPath: string): Promise<void> => {
  const apiKey = process.env.OPEN_DATA_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPEN_DATA_KEY is required to download static assets");
  }

  debugLog("STATIC", `downloading GTFS static data from ${TFNSW_STATIC_TIMETABLE_URL}`);
  const signal = AbortSignal.timeout(STATIC_DOWNLOAD_TIMEOUT_MS);
  const response = await axios.get<NodeJS.ReadableStream>(TFNSW_STATIC_TIMETABLE_URL, {
    responseType: "stream",
    signal,
    headers: {
      Authorization: `apikey ${apiKey}`,
      Accept: "application/zip",
    },
  });
  await pipelineAsync(response.data, createWriteStream(targetPath), { signal });
};

const installDownloadedZip = async (snapshotDate: string): Promise<void> => {
  await mkdir(ASSETS_DIR, { recursive: true });
  const zipPath = resolve(ASSETS_DIR, GTFS_ZIP_FILE);
  const downloadPath = `${zipPath}.download`;
  try {
    await downloadGtfsZip(downloadPath);
    const snapshot = await buildStaticSnapshot(downloadPath, snapshotDate);
    await rename(downloadPath, zipPath);
    await writeFileAtomic(
      resolve(ASSETS_DIR, STATIC_ASSETS_META_FILE),
      JSON.stringify({ fetchedDate: snapshotDate })
    );
    setStaticTimetable(snapshot);
    await Promise.all(
      LEGACY_ASSET_FILES.map((fileName) => rm(resolve(ASSETS_DIR, fileName), { force: true }))
    );
  } finally {
    await rm(downloadPath, { force: true });
  }
};

export const updateStaticTimetable = async (): Promise<void> => {
  if (updateInFlight) {
    return updateInFlight;
  }

  updateInFlight = (async () => {
    const snapshotDate = sydneyTodayIsoDate();
    const zipPath = resolve(ASSETS_DIR, GTFS_ZIP_FILE);
    const hasZip = await fileExists(zipPath);
    const meta = await readStaticAssetsMeta(ASSETS_DIR);

    if (!hasZip || meta?.fetchedDate !== snapshotDate) {
      try {
        await installDownloadedZip(snapshotDate);
        return;
      } catch (error) {
        if (!hasZip) {
          throw error;
        }
        console.error(
          `Static GTFS download failed, keeping the existing timetable: ${describeError(error)}`
        );
      }
    }

    if (getStaticTimetable().snapshotDate !== snapshotDate) {
      setStaticTimetable(await buildStaticSnapshot(zipPath, snapshotDate));
    }
  })();

  try {
    await updateInFlight;
  } finally {
    updateInFlight = null;
  }
};

export const getRouteStaticAssets = async (): Promise<{
  stops: StaticStop[];
  tracks: TrainTracksResponse;
}> => {
  const { stops, tracks } = getStaticTimetable();
  return { stops, tracks };
};
