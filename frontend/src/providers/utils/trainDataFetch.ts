import type { Dispatch, SetStateAction } from "react";
import { getTrainStops, getTrainTracks } from "@/client-api/train";
import type { StaticLoadStatus, TrainStaticState } from "../AppProvider";

type SetTrainStatic = Dispatch<SetStateAction<TrainStaticState>>;
type SetStaticLoadStatus = Dispatch<SetStateAction<StaticLoadStatus>>;

const RETRY_BASE_DELAY_MS = 5_000;
const RETRY_MAX_DELAY_MS = 60_000;

export const isRateLimitedError = (error: unknown): boolean => {
  return error instanceof Error && error.message === "HTTP 429";
};

const loadWithRetry = <T>(
  request: () => Promise<T>,
  onLoaded: (data: T) => void,
  onFailed: (error: unknown) => void
): (() => void) => {
  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const attempt = (attemptNumber: number) => {
    request().then(
      (data) => {
        if (!cancelled) onLoaded(data);
      },
      (error) => {
        if (cancelled) return;
        onFailed(error);
        const delayMs = Math.min(RETRY_BASE_DELAY_MS * 2 ** attemptNumber, RETRY_MAX_DELAY_MS);
        timeoutId = setTimeout(() => attempt(attemptNumber + 1), delayMs);
      }
    );
  };
  attempt(0);

  return () => {
    cancelled = true;
    if (timeoutId != null) clearTimeout(timeoutId);
  };
};

export const loadTrainStaticData = (
  setTrainStatic: SetTrainStatic,
  setStaticLoadStatus: SetStaticLoadStatus,
  currentStatus: StaticLoadStatus
): (() => void) => {
  const cancels: (() => void)[] = [];

  if (currentStatus.tracks !== "ready") {
    setStaticLoadStatus((prev) => ({ ...prev, tracks: "loading" }));
    cancels.push(
      loadWithRetry(
        getTrainTracks,
        (tracks) => {
          setTrainStatic((prev) => ({ ...prev, tracks }));
          setStaticLoadStatus((prev) => ({ ...prev, tracks: "ready" }));
        },
        (error) => {
          setStaticLoadStatus((prev) => ({
            ...prev,
            tracks: isRateLimitedError(error) ? "ratelimited" : "error",
          }));
        }
      )
    );
  }

  if (currentStatus.stops !== "ready") {
    setStaticLoadStatus((prev) => ({ ...prev, stops: "loading" }));
    cancels.push(
      loadWithRetry(
        getTrainStops,
        (stops) => {
          setTrainStatic((prev) => ({ ...prev, stops }));
          setStaticLoadStatus((prev) => ({ ...prev, stops: "ready" }));
        },
        (error) => {
          setStaticLoadStatus((prev) => ({
            ...prev,
            stops: isRateLimitedError(error) ? "ratelimited" : "error",
          }));
        }
      )
    );
  }

  return () => {
    for (const cancel of cancels) cancel();
  };
};
