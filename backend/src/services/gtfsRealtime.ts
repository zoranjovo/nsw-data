import type { AxiosInstance } from "axios";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

export type DecodedFeed = ReturnType<
  typeof GtfsRealtimeBindings.transit_realtime.FeedMessage.decode
>;

export const optionalField = <T extends object, K extends keyof T>(
  message: T | null | undefined,
  field: K
): NonNullable<T[K]> | null => {
  return message != null && Object.hasOwn(message, field) ? (message[field] ?? null) : null;
};

export const fetchGtfsRealtimeFeed = async (
  client: AxiosInstance,
  url: string
): Promise<DecodedFeed> => {
  const { data } = await client.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
  });

  const binary = new Uint8Array(data);
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(binary);
};
