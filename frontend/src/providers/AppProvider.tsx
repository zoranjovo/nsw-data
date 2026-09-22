import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { startRealtimePolling, stopRealtimePolling } from "@/fetch/runtime";
import { loadTrainMovementSettings, saveTrainMovementSettings } from "@/lib/localStorage";
import type { TrainStopsResponse } from "@/types/train/stops";
import type { StaticStop, TimetableData } from "@/types/train/timetable";
import type { TrainTracksResponse } from "@/types/train/tracks";
import type { TrainPosition, TrainPositions } from "@/types/train/train";
import type { TripUpdatesResponse } from "@/types/train/tripUpdates";
import { isRateLimitedError, loadTrainStaticData } from "./utils/trainDataFetch";

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
  timetables: Map<string, TimetableData>;
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
  timetables: new Map(),
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

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const currentPage = location.pathname.replace(/^\/+|\/+$/g, "").toLowerCase() || "trains";
  const [mapReady, setMapReady] = useState(false);
  const [storedTrainMovementSettings] = useState(loadTrainMovementSettings);
  const [interpolatedTrainMovement, setInterpolatedTrainMovement] = useState(
    storedTrainMovementSettings.interpolatedTrainMovement
  );
  const [smoothInterpolatedTrainMovement, setSmoothInterpolatedTrainMovement] = useState(
    storedTrainMovementSettings.smoothInterpolatedTrainMovement
  );
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null);
  const [trainRealtime, setTrainRealtime] = useState<TrainRealtimeState>(initialTrainRealtime);
  const [trainStatic, setTrainStatic] = useState<TrainStaticState>(initialTrainStatic);
  const [staticLoadStatus, setStaticLoadStatus] =
    useState<StaticLoadStatus>(initialStaticLoadStatus);

  useEffect(() => {
    saveTrainMovementSettings({ interpolatedTrainMovement, smoothInterpolatedTrainMovement });
  }, [interpolatedTrainMovement, smoothInterpolatedTrainMovement]);

  const staticLoadStatusRef = useRef(staticLoadStatus);
  useEffect(() => {
    staticLoadStatusRef.current = staticLoadStatus;
  }, [staticLoadStatus]);

  useEffect(() => {
    if (currentPage !== "trains") {
      stopRealtimePolling();
      return;
    }

    const cancelStaticLoad = loadTrainStaticData(
      setTrainStatic,
      setStaticLoadStatus,
      staticLoadStatusRef.current
    );

    setTrainRealtime((prev) => ({
      ...prev,
      status: prev.positions.items.length > 0 ? "ready" : "loading",
    }));
    startRealtimePolling(
      (data) => {
        setTrainRealtime((prev) => {
          const isNewer =
            data.positions.fetchedAt > prev.positions.fetchedAt ||
            data.tripUpdates.fetchedAt > prev.tripUpdates.fetchedAt;
          if (!isNewer) {
            return prev.status === "ready" && prev.error == null
              ? prev
              : { ...prev, status: "ready", error: null };
          }
          return {
            status: "ready",
            positions: data.positions,
            tripUpdates: data.tripUpdates,
            error: null,
          };
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
      cancelStaticLoad();
      stopRealtimePolling();
    };
  }, [currentPage]);

  const cacheTimetables = useCallback((timetables: TimetableData[]) => {
    setTrainStatic((prev) => {
      const newer = timetables.filter((timetable) => {
        const cached = prev.timetables.get(timetable.tripId);
        return (
          cached == null ||
          (timetable.tripUpdatesFetchedAt ?? 0) > (cached.tripUpdatesFetchedAt ?? 0)
        );
      });
      if (newer.length === 0) return prev;
      const next = new Map(prev.timetables);
      for (const timetable of newer) {
        next.set(timetable.tripId, timetable);
      }
      return { ...prev, timetables: next };
    });
  }, []);

  const cacheTimetable = useCallback(
    (timetable: TimetableData) => cacheTimetables([timetable]),
    [cacheTimetables]
  );

  useEffect(() => {
    const liveTripIds = new Set(trainRealtime.positions.items.map((position) => position.tripId));
    const selectedTripId =
      selectedItem?.type === "train" ? (selectedItem.data as TrainPosition).tripId : null;
    setTrainStatic((prev) => {
      const goneTripIds = [...prev.timetables.keys()].filter(
        (tripId) => !liveTripIds.has(tripId) && tripId !== selectedTripId
      );
      if (goneTripIds.length === 0) return prev;
      const next = new Map(prev.timetables);
      for (const tripId of goneTripIds) {
        next.delete(tripId);
      }
      return { ...prev, timetables: next };
    });
  }, [trainRealtime.positions, selectedItem]);

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
