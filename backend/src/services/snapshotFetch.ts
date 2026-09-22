import { DateTime } from "luxon";
import { debugLog } from "../utils/debug";
import { describeError } from "../utils/errors";

export const ensureFreshSnapshot = async <T extends { fetchedAt: number }>(
  getSnapshot: () => T,
  fetchFn: () => Promise<void>,
  ttlMs: number,
  opts?: {
    isFresh?: (snapshot: T, now: number) => boolean;
  }
): Promise<T> => {
  const snapshot = getSnapshot();
  const now = DateTime.now().toMillis();
  const fresh = opts?.isFresh ? opts.isFresh(snapshot, now) : snapshot.fetchedAt + ttlMs >= now;

  if (fresh) {
    return snapshot;
  }

  try {
    await fetchFn();
  } catch (error) {
    if (snapshot.fetchedAt === 0) {
      throw error;
    }
    const ageSeconds = Math.round((now - snapshot.fetchedAt) / 1000);
    debugLog("STALE", `serving snapshot from ${ageSeconds}s ago: ${describeError(error)}`);
  }
  return getSnapshot();
};
