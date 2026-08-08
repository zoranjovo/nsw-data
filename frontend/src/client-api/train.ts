import axios from "axios";
import type { TrainAlertsResponse } from "@/types/train/alerts";
import type { TrainRealtimeResponse } from "@/types/train/realtime";
import type { TrainStopsResponse } from "@/types/train/stops";
import type { TimetableData } from "@/types/train/timetable";
import type { TrainTracksResponse } from "@/types/train/tracks";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api";

const toRequestError = (error: unknown, fallbackMessage: string): Error => {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      return new Error(`HTTP ${error.response.status}`);
    }
    if (error.message) {
      return new Error(error.message);
    }
  }
  return new Error(fallbackMessage);
};

const request = async <T>(
  performRequest: () => Promise<{ data: T }>,
  fallbackMessage: string
): Promise<T> => {
  try {
    const response = await performRequest();
    return response.data;
  } catch (error) {
    throw toRequestError(error, fallbackMessage);
  }
};

export const getTrainTracks = (): Promise<TrainTracksResponse> =>
  request(
    () => axios.get<TrainTracksResponse>(`${API_URL}/trains/tracks`),
    "Failed to load tracks"
  );

export const getTrainStops = (): Promise<TrainStopsResponse> =>
  request(() => axios.get<TrainStopsResponse>(`${API_URL}/trains/stops`), "Failed to load stops");

export const getTrainRealtime = (): Promise<TrainRealtimeResponse> =>
  request(
    () => axios.get<TrainRealtimeResponse>(`${API_URL}/trains/realtime`),
    "Failed to load realtime data"
  );

export const getTrainAlerts = (): Promise<TrainAlertsResponse> =>
  request(
    () => axios.get<TrainAlertsResponse>(`${API_URL}/trains/alerts`),
    "Failed to load alerts"
  );

export const getTrainTimetable = (tripId: string): Promise<TimetableData> =>
  request(
    () => axios.get<TimetableData>(`${API_URL}/trains/timetable/${tripId}`),
    "Failed to load timetable data"
  );

export const getTrainTimetableBulk = (tripIds: string[]): Promise<TimetableData[]> =>
  request(
    () => axios.post<TimetableData[]>(`${API_URL}/trains/timetable/bulk`, { tripIds }),
    "Failed to load timetable data"
  );
