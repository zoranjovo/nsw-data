import type { Dispatch, SetStateAction } from "react";
import { getTrainStops, getTrainTracks } from "@/client-api/train";
import type { StaticLoadStatus, TrainStaticState } from "../AppProvider";

type SetTrainStatic = Dispatch<SetStateAction<TrainStaticState>>;
type SetStaticLoadStatus = Dispatch<SetStateAction<StaticLoadStatus>>;

const isRateLimitedError = (error: unknown): boolean => {
  return error instanceof Error && error.message === "HTTP 429";
};

export const loadTrainStaticData = (
  setTrainStatic: SetTrainStatic,
  setStaticLoadStatus: SetStaticLoadStatus
): void => {
  setStaticLoadStatus((prev) => ({
    ...prev,
    tracks: "loading",
    stops: "loading",
  }));

  void getTrainTracks()
    .then((tracks) => {
      setTrainStatic((prev) => ({
        ...prev,
        tracks,
      }));
      setStaticLoadStatus((prev) => ({
        ...prev,
        tracks: "ready",
      }));
    })
    .catch((error) => {
      setStaticLoadStatus((prev) => ({
        ...prev,
        tracks: isRateLimitedError(error) ? "ratelimited" : "error",
      }));
    });

  void getTrainStops()
    .then((stops) => {
      setTrainStatic((prev) => ({
        ...prev,
        stops,
      }));
      setStaticLoadStatus((prev) => ({
        ...prev,
        stops: "ready",
      }));
    })
    .catch((error) => {
      setStaticLoadStatus((prev) => ({
        ...prev,
        stops: isRateLimitedError(error) ? "ratelimited" : "error",
      }));
    });
};
