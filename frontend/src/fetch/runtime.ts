import { getTrainRealtime } from "@/client-api/train";
import type { TrainRealtimeResponse } from "@/types/train/realtime";

const REALTIME_POLL_INTERVAL_MS = 5000;

let realtimeIntervalId: ReturnType<typeof setInterval> | null = null;

export const startRealtimePolling = (
  onRealtime: (data: TrainRealtimeResponse) => void,
  onError?: (err: Error) => void
): void => {
  if (realtimeIntervalId) return;

  const poll = async () => {
    try {
      const data = await getTrainRealtime();
      onRealtime(data);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  poll();
  realtimeIntervalId = setInterval(poll, REALTIME_POLL_INTERVAL_MS);
};

export const stopRealtimePolling = (): void => {
  if (realtimeIntervalId) {
    clearInterval(realtimeIntervalId);
    realtimeIntervalId = null;
  }
};
