import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, LiveTrainData } from "@/providers/AppProvider";
import { makeLiveTrainData, makeRealtime, makeStop, makeTimetable } from "@/test/fixtures";
import type { TimetableData } from "@/types/train/timetable";
import { TripTimeline } from "./TripTimeline";

const mocks = vi.hoisted(() => ({
  live: null as unknown as LiveTrainData,
  getTrainTimetable: vi.fn(),
}));

vi.mock("@/providers/AppProvider", () => ({
  useAppContext: () =>
    ({
      trainStatic: {
        status: "ready",
        tracks: { type: "FeatureCollection", name: "train-tracks", features: [] },
        stops: [],
        error: null,
      },
    }) as unknown as AppState,
  useLiveTrainData: () => mocks.live,
}));

vi.mock("@/client-api/train", () => ({
  getTrainTimetable: mocks.getTrainTimetable,
}));

const NOW = 1_000;
const scrollIntoView = vi.fn();

const withTimetable = (timetable: TimetableData, tripUpdatesFetchedAt = 0) => {
  mocks.live = makeLiveTrainData({
    trainRealtime: makeRealtime([], tripUpdatesFetchedAt),
    timetables: new Map([[timetable.tripId, timetable]]),
  });
};

const stopRow = (name: string) => screen.getByText(name).closest("li");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
  Element.prototype.scrollIntoView = scrollIntoView;
  mocks.getTrainTimetable.mockReset();
  mocks.getTrainTimetable.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  vi.useRealTimers();
  scrollIntoView.mockReset();
});

describe("TripTimeline", () => {
  it("marks stops before the next stop as past and after it as future", () => {
    withTimetable(
      makeTimetable("trip", [
        makeStop(1, "Central", 800),
        makeStop(2, "Redfern", 1100),
        makeStop(3, "Strathfield", 1300),
      ])
    );

    render(<TripTimeline tripId="trip" showRaw={false} />);

    expect(stopRow("Central")?.dataset.state).toBe("past");
    expect(stopRow("Redfern")?.dataset.state).toBe("next");
    expect(stopRow("Strathfield")?.dataset.state).toBe("future");
    expect(screen.getByText("Next stop")).toBeTruthy();
  });

  it("scrolls the next stop into view", () => {
    withTimetable(
      makeTimetable("trip", [makeStop(1, "Central", 800), makeStop(2, "Redfern", 1100)])
    );

    render(<TripTimeline tripId="trip" showRaw={false} />);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(stopRow("Redfern"));
  });

  it("picks the next stop from the stops it shows when the next stop by time is hidden", () => {
    withTimetable(
      makeTimetable("trip", [
        makeStop(1, "Central", 800, 800, { hasRealtimeStopUpdate: true }),
        makeStop(2, "Homebush", 1100),
        makeStop(3, "Strathfield", 1200, 1200, { hasRealtimeStopUpdate: true }),
      ])
    );

    render(<TripTimeline tripId="trip" showRaw={false} />);

    expect(screen.queryByText("Homebush")).toBeNull();
    expect(stopRow("Strathfield")?.dataset.state).toBe("next");
    expect(scrollIntoView.mock.contexts[0]).toBe(stopRow("Strathfield"));
  });

  it("leaves skipped stops out of the list", () => {
    withTimetable(
      makeTimetable("trip", [
        makeStop(1, "Central", 800),
        makeStop(2, "Lidcombe", 1100, 1100, { skipped: true }),
        makeStop(3, "Parramatta", 1300),
      ])
    );

    render(<TripTimeline tripId="trip" showRaw={false} />);

    expect(screen.queryByText("Lidcombe")).toBeNull();
    expect(stopRow("Parramatta")?.dataset.state).toBe("next");
  });

  it("shows a train dwelling at its next stop as waiting to depart", () => {
    withTimetable(
      makeTimetable("trip", [makeStop(1, "Central", 800), makeStop(2, "Redfern", 950, 1050)])
    );

    render(<TripTimeline tripId="trip" showRaw={false} />);

    expect(screen.getByText("Waiting to depart")).toBeTruthy();
  });

  it("shows an error when the timetable cannot be loaded", async () => {
    mocks.live = makeLiveTrainData();
    mocks.getTrainTimetable.mockRejectedValue(new Error("HTTP 500"));

    render(<TripTimeline tripId="trip" showRaw={false} />);

    expect(await screen.findByText("Could not load timetable.")).toBeTruthy();
  });

  it("caches a fetched timetable", async () => {
    const cacheTimetable = vi.fn();
    const timetable = makeTimetable("trip", [makeStop(1, "Central", 1100)]);
    mocks.live = makeLiveTrainData({ cacheTimetable });
    mocks.getTrainTimetable.mockResolvedValue(timetable);

    render(<TripTimeline tripId="trip" showRaw={false} />);

    await vi.waitFor(() => expect(cacheTimetable).toHaveBeenCalledWith(timetable));
    expect(mocks.getTrainTimetable).toHaveBeenCalledWith("trip");
  });

  it("does not refetch a timetable that is still fresh", () => {
    withTimetable(makeTimetable("trip", [makeStop(1, "Central", 1100)], 0), 29_999);

    render(<TripTimeline tripId="trip" showRaw={false} />);

    expect(mocks.getTrainTimetable).not.toHaveBeenCalled();
  });

  it("refetches a stale timetable while still showing it", () => {
    withTimetable(makeTimetable("trip", [makeStop(1, "Central", 1100)], 0), 30_000);

    render(<TripTimeline tripId="trip" showRaw={false} />);

    expect(mocks.getTrainTimetable).toHaveBeenCalledWith("trip");
    expect(screen.getByText("Central")).toBeTruthy();
  });
});
