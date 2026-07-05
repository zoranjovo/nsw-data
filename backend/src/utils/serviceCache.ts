import { LRUCache } from "lru-cache";

const serviceCache = new LRUCache<string, object>({
  max: 128,
});

export const getCached = <T extends object>(key: string): T | null => {
  return (serviceCache.get(key) as T | undefined) ?? null;
};

export const setCached = <T extends object>(key: string, value: T): void => {
  serviceCache.set(key, value);
};

export type SnapshotStore<T extends object> = {
  get: () => T;
  set: (value: T) => void;
  getFetchPromise: () => Promise<void> | null;
  setFetchPromise: (nextPromise: Promise<void> | null) => void;
};

export const createSnapshotStore = <T extends object>(
  key: string,
  defaultValue: T
): SnapshotStore<T> => {
  let fetchPromise: Promise<void> | null = null;

  return {
    get: () => getCached<T>(key) ?? defaultValue,
    set: (value: T) => setCached<T>(key, value),
    getFetchPromise: () => fetchPromise,
    setFetchPromise: (nextPromise: Promise<void> | null) => {
      fetchPromise = nextPromise;
    },
  };
};
