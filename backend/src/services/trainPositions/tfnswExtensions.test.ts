import { describe, expect, it } from "vitest";
import { decodeGtfsRealtimeFeed } from "../gtfsRealtime";
import { readTfnswVehicleExtensions } from "./tfnswExtensions";
import { parseTripSetInfo, toTrainPositions } from "./utils";

const varint = (value: number): number[] => {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 127) {
    bytes.push((remaining % 128) | 128);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
  return bytes;
};

const varintField = (number: number, value: number): number[] => [
  ...varint(number * 8),
  ...varint(value),
];

const messageField = (number: number, payload: number[] | string): number[] => {
  const bytes = typeof payload === "string" ? [...new TextEncoder().encode(payload)] : payload;
  return [...varint(number * 8 + 2), ...varint(bytes.length), ...bytes];
};

const floatField = (number: number, value: number): number[] => {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return [...varint(number * 8 + 5), ...new Uint8Array(view.buffer)];
};

const vehicleEntity = (
  entityId: string,
  tripId: string,
  vehicleModel: string | null,
  carriages: number
): number[] =>
  messageField(2, [
    ...messageField(1, entityId),
    ...messageField(4, [
      ...messageField(1, [...messageField(1, tripId), ...messageField(5, "T1_1a")]),
      ...messageField(2, [...floatField(1, -33.87), ...floatField(2, 151.21)]),
      ...varintField(5, Math.floor(Date.now() / 1000)),
      ...messageField(8, [
        ...messageField(1, "1234.5678"),
        ...messageField(2, "21:10 Central Station to Hornsby Station"),
        ...(vehicleModel ? messageField(1007, messageField(3, vehicleModel)) : []),
      ]),
      ...Array.from({ length: carriages }, (_, index) =>
        messageField(1007, varintField(2, index + 1))
      ).flat(),
    ]),
  ]);

const feedBinary = (...entities: number[][]): Uint8Array =>
  new Uint8Array([...messageField(1, messageField(1, "2.0")), ...entities.flat()]);

describe("readTfnswVehicleExtensions", () => {
  it("reads the vehicle model and carriage count for each entity", () => {
    const binary = feedBinary(
      vehicleEntity("1", "130U.947.166.12.A.8.91441911", "B", 8),
      vehicleEntity("2", "NonTimetabled.M672", null, 0)
    );

    const extensions = readTfnswVehicleExtensions(binary);

    expect(extensions.get("1")).toEqual({ vehicleModel: "B", carriageCount: 8 });
    expect(extensions.get("2")).toEqual({ vehicleModel: null, carriageCount: 0 });
  });

  it("leaves the standard decoder able to read the same feed", () => {
    const binary = feedBinary(vehicleEntity("1", "130U.947.166.12.A.8.91441911", "B", 8));

    const feed = decodeGtfsRealtimeFeed(binary);

    expect(feed.entity[0].vehicle?.trip?.tripId).toBe("130U.947.166.12.A.8.91441911");
    expect(feed.entity[0].vehicle?.vehicle?.id).toBe("1234.5678");
  });
});

describe("parseTripSetInfo", () => {
  it("reads the planned set type and car count from a timetabled trip id", () => {
    expect(parseTripSetInfo("C791.947.166.4.D.4.91439240")).toEqual({ setType: "D", carCount: 4 });
  });

  it("returns nothing for non-timetabled trips and zero-car freight", () => {
    expect(parseTripSetInfo("NonTimetabled.M672")).toEqual({ setType: null, carCount: null });
    expect(parseTripSetInfo("CA15.947.166.4.W.0.91437433")).toEqual({
      setType: "W",
      carCount: null,
    });
  });
});

describe("toTrainPositions fleet details", () => {
  it("prefers the live vehicle model and consist over the planned trip id", () => {
    const binary = feedBinary(vehicleEntity("1", "130U.947.166.12.A.8.91441911", "B", 6));

    const [position] = toTrainPositions(
      decodeGtfsRealtimeFeed(binary),
      readTfnswVehicleExtensions(binary)
    );

    expect(position.fleetCode).toBe("B");
    expect(position.carCount).toBe(6);
  });

  it("falls back to the trip id when the feed has no extension", () => {
    const binary = feedBinary(vehicleEntity("1", "C791.947.166.4.D.4.91439240", null, 0));

    const [position] = toTrainPositions(decodeGtfsRealtimeFeed(binary));

    expect(position.fleetCode).toBe("D");
    expect(position.carCount).toBe(4);
  });
});
