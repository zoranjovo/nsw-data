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
