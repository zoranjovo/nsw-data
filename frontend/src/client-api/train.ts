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

export const getTrainTracks = async (): Promise<TrainTracksResponse> => {
  try {
    const response = await axios.get<TrainTracksResponse>(`${API_URL}/trains/tracks`);
    return response.data;
  } catch (error) {
    throw toRequestError(error, "Failed to load tracks");
  }
};

export const getTrainStops = async (): Promise<TrainStopsResponse> => {
  try {
    const response = await axios.get<TrainStopsResponse>(`${API_URL}/trains/stops`);
    return response.data;
  } catch (error) {
    throw toRequestError(error, "Failed to load stops");
  }
};

export const getTrainRealtime = async (): Promise<TrainRealtimeResponse> => {
  try {
    const response = await axios.get<TrainRealtimeResponse>(`${API_URL}/trains/realtime`);
    return response.data;
  } catch (error) {
    throw toRequestError(error, "Failed to load realtime data");
  }
};

export const getTrainAlerts = async (): Promise<TrainAlertsResponse> => {
  try {
    const response = await axios.get<TrainAlertsResponse>(`${API_URL}/trains/alerts`);
    return response.data;
  } catch (error) {
    throw toRequestError(error, "Failed to load alerts");
  }
};

export const getTrainTimetable = async (tripId: string): Promise<TimetableData> => {
  try {
    const response = await axios.get<TimetableData>(`${API_URL}/trains/timetable/${tripId}`);
    return response.data;
  } catch (error) {
    throw toRequestError(error, "Failed to load timetable data");
  }
};

export const getTrainTimetableBulk = async (tripIds: string[]): Promise<TimetableData[]> => {
  try {
    const response = await axios.post<TimetableData[]>(`${API_URL}/trains/timetable/bulk`, {
      tripIds,
    });
    return response.data;
  } catch (error) {
    throw toRequestError(error, "Failed to load timetable data");
  }
};
