import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { startRealtimePolling, stopRealtimePolling } from "@/fetch/runtime";
import type { TrainStopsResponse } from "@/types/train/stops";
import type { StaticStop, TimetableData } from "@/types/train/timetable";
import type { TrainTracksResponse } from "@/types/train/tracks";
import type { TrainPosition, TrainPositions } from "@/types/train/train";
import type { TripUpdatesResponse } from "@/types/train/tripUpdates";
import { loadTrainStaticData } from "./utils/trainDataFetch";

export type SelectedItem = {
  type: "train" | "station";
  data: TrainPosition | StaticStop;
} | null;

export type TrainRealtimeState = {
  status: "idle" | "loading" | "ready" | "error" | "ratelimited";
  positions: TrainPositions;
  tripUpdates: TripUpdatesResponse;
  error: string | null;
};

export type TrainStaticState = {
  status: "idle" | "loading" | "ready" | "error";
  timetables: TimetableData[];
  tracks: TrainTracksResponse;
  stops: TrainStopsResponse;
  error: string | null;
};

export type StaticLoadStatus = {
  tracks: "idle" | "loading" | "ready" | "error" | "ratelimited";
  stops: "idle" | "loading" | "ready" | "error" | "ratelimited";
  timetable: "idle" | "loading" | "ready" | "error" | "ratelimited";
};

export interface AppState {
  mapReady: boolean;
  setMapReady: Dispatch<SetStateAction<boolean>>;
  currentPage: string;
  interpolatedTrainMovement: boolean;
  setInterpolatedTrainMovement: Dispatch<SetStateAction<boolean>>;
  smoothInterpolatedTrainMovement: boolean;
  setSmoothInterpolatedTrainMovement: Dispatch<SetStateAction<boolean>>;
  selectedItem: SelectedItem;
  setSelectedItem: Dispatch<SetStateAction<SelectedItem>>;
  trainRealtime: TrainRealtimeState;
  trainStatic: TrainStaticState;
  staticLoadStatus: StaticLoadStatus;
  cacheTimetable: (timetable: TimetableData) => void;
  cacheTimetables: (timetables: TimetableData[]) => void;
}

const initialTrainRealtime: TrainRealtimeState = {
  status: "idle",
  positions: {
    items: [],
    fetchedAt: 0,
  },
  tripUpdates: {
    items: [],
    fetchedAt: 0,
  },
  error: null,
};

const initialTrainStatic: TrainStaticState = {
  status: "idle",
  timetables: [],
  tracks: {
    type: "FeatureCollection",
    name: "train-tracks",
    features: [],
  },
  stops: [],
  error: null,
};

const initialStaticLoadStatus: StaticLoadStatus = {
  tracks: "loading",
  stops: "loading",
  timetable: "ready",
};

const AppContext = createContext<AppState | null>(null);

const isRateLimitedError = (error: unknown): boolean => {
  return error instanceof Error && error.message === "HTTP 429";
};

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const currentPage = location.pathname.replace(/^\//, "") || "trains";
  const [mapReady, setMapReady] = useState(false);
  const [interpolatedTrainMovement, setInterpolatedTrainMovement] = useState(true);
  const [smoothInterpolatedTrainMovement, setSmoothInterpolatedTrainMovement] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null);
  const [trainRealtime, setTrainRealtime] = useState<TrainRealtimeState>(initialTrainRealtime);
  const [trainStatic, setTrainStatic] = useState<TrainStaticState>(initialTrainStatic);
  const [staticLoadStatus, setStaticLoadStatus] =
    useState<StaticLoadStatus>(initialStaticLoadStatus);

  useEffect(() => {
    if (currentPage !== "trains") {
      stopRealtimePolling();
      return;
    }

    loadTrainStaticData(setTrainStatic, setStaticLoadStatus);

    setTrainRealtime((prev) => ({
      ...prev,
      status: prev.positions.items.length > 0 ? "ready" : "loading",
    }));
    startRealtimePolling(
      (data) => {
        setTrainRealtime({
          status: "ready",
          positions: data.positions,
          tripUpdates: data.tripUpdates,
          error: null,
        });
      },
      (error) => {
        const isRateLimited = isRateLimitedError(error);
        setTrainRealtime((prev) => ({
          ...prev,
          status:
            prev.positions.items.length > 0 ? "ready" : isRateLimited ? "ratelimited" : "error",
          error: isRateLimited ? "Ratelimited" : "Failed to fetch realtime data",
        }));
      }
    );

    return () => {
      stopRealtimePolling();
    };
  }, [currentPage]);

  const cacheTimetable = useCallback((timetable: TimetableData) => {
    setTrainStatic((prev) => {
      if (prev.timetables.some((t) => t.tripId === timetable.tripId)) return prev;
      return { ...prev, timetables: [...prev.timetables, timetable] };
    });
  }, []);

  const cacheTimetables = useCallback((timetables: TimetableData[]) => {
    setTrainStatic((prev) => {
      const existingTripIds = new Set(prev.timetables.map((timetable) => timetable.tripId));
      const newTimetables = timetables.filter(
        (timetable) => !existingTripIds.has(timetable.tripId)
      );
      if (newTimetables.length === 0) return prev;
      return { ...prev, timetables: [...prev.timetables, ...newTimetables] };
    });
  }, []);

  const value = useMemo<AppState>(
    () => ({
      mapReady,
      setMapReady,
      currentPage,
      interpolatedTrainMovement,
      setInterpolatedTrainMovement,
      smoothInterpolatedTrainMovement,
      setSmoothInterpolatedTrainMovement,
      selectedItem,
      setSelectedItem,
      trainRealtime,
      trainStatic,
      staticLoadStatus,
      cacheTimetable,
      cacheTimetables,
    }),
    [
      mapReady,
      currentPage,
      interpolatedTrainMovement,
      smoothInterpolatedTrainMovement,
      selectedItem,
      trainRealtime,
      trainStatic,
      staticLoadStatus,
      cacheTimetable,
      cacheTimetables,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = (): AppState => {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useAppContext must be used within AppProvider");
  }
  return ctx;
};
