import { DateTime } from "luxon";

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

  await fetchFn();
  return getSnapshot();
};
