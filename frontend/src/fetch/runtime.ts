import { getTrainRealtime } from "@/client-api/train";
import type { TrainRealtimeResponse } from "@/types/train/realtime";

const REALTIME_POLL_INTERVAL_MS = 5000;
const MAX_ERROR_BACKOFF_MS = 60_000;

let stopActivePolling: (() => void) | null = null;

export const startRealtimePolling = (
  onRealtime: (data: TrainRealtimeResponse) => void,
  onError?: (err: Error) => void
): void => {
  if (stopActivePolling) return;

  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let consecutiveErrors = 0;

  const poll = async () => {
    timeoutId = null;
    if (document.hidden) return;

    controller = new AbortController();
    try {
      const data = await getTrainRealtime(controller.signal);
      if (stopped) return;
      consecutiveErrors = 0;
      onRealtime(data);
    } catch (err) {
      if (stopped) return;
      consecutiveErrors += 1;
      onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      controller = null;
    }

    if (document.hidden) return;
    const delayMs = Math.min(
      REALTIME_POLL_INTERVAL_MS * 2 ** consecutiveErrors,
      MAX_ERROR_BACKOFF_MS
    );
    timeoutId = setTimeout(poll, delayMs);
  };

  const onVisibilityChange = () => {
    if (!document.hidden && timeoutId == null && controller == null) {
      void poll();
    }
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  void poll();

  stopActivePolling = () => {
    stopped = true;
    if (timeoutId != null) clearTimeout(timeoutId);
    controller?.abort();
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
};

export const stopRealtimePolling = (): void => {
  stopActivePolling?.();
  stopActivePolling = null;
};
