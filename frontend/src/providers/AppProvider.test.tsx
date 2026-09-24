import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeStop, makeTimetable, makeTrain } from "@/test/fixtures";
import type { TrainRealtimeResponse } from "@/types/train/realtime";
import type { TrainPosition } from "@/types/train/train";
import {
  AppProvider,
  type AppState,
  type LiveTrainData,
  useAppContext,
  useLiveTrainData,
} from "./AppProvider";

const mocks = vi.hoisted(() => ({
  startRealtimePolling: vi.fn(),
  stopRealtimePolling: vi.fn(),
}));

vi.mock("@/fetch/runtime", () => ({
  startRealtimePolling: mocks.startRealtimePolling,
  stopRealtimePolling: mocks.stopRealtimePolling,
}));

vi.mock("./utils/trainDataFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./utils/trainDataFetch")>()),
  loadTrainStaticData: () => () => {},
}));

let app: AppState;
let live: LiveTrainData;

const Probe = () => {
  app = useAppContext();
  live = useLiveTrainData();
  return null;
};

const renderProvider = (path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppProvider>
        <Probe />
      </AppProvider>
    </MemoryRouter>
  );

const pollCallbacks = () => {
  const [onRealtime, onError] = mocks.startRealtimePolling.mock.calls[0] as [
    (data: TrainRealtimeResponse) => void,
    (error: Error) => void,
  ];
  return { onRealtime, onError };
};

const realtime = (positions: TrainPosition[], fetchedAt: number) =>
  ({
    positions: { items: positions, fetchedAt },
    tripUpdates: { items: [], fetchedAt },
  }) as TrainRealtimeResponse;

const timetable = (tripId: string, fetchedAt: number) =>
  makeTimetable(tripId, [makeStop(1, "Central", 1000)], fetchedAt);

beforeEach(() => {
  mocks.startRealtimePolling.mockReset();
  mocks.stopRealtimePolling.mockReset();
  window.localStorage.clear();
});

describe("AppProvider", () => {
  it("only replaces a cached timetable with a newer one", () => {
    renderProvider();
    const newer = timetable("a", 2_000);

    act(() => live.cacheTimetable(newer));
    act(() => live.cacheTimetable(timetable("a", 1_000)));

    expect(live.timetables.get("a")).toBe(newer);

    const newest = timetable("a", 3_000);
    act(() => live.cacheTimetables([newest, timetable("b", 0)]));

    expect(live.timetables.get("a")).toBe(newest);
    expect(live.timetables.has("b")).toBe(true);
  });

  it("keeps the same timetables map when nothing newer arrives", () => {
    renderProvider();
    act(() => live.cacheTimetable(timetable("a", 2_000)));
    const before = live.timetables;

    act(() => live.cacheTimetable(timetable("a", 2_000)));

    expect(live.timetables).toBe(before);
  });

  it("drops timetables for trips that leave the feed but keeps the selected train's", () => {
    renderProvider();
    const { onRealtime } = pollCallbacks();
    const selected = makeTrain("selected");

    act(() => onRealtime(realtime([selected, makeTrain("gone"), makeTrain("live")], 1_000)));
    act(() => {
      live.cacheTimetables([timetable("selected", 0), timetable("gone", 0), timetable("live", 0)]);
      app.setSelectedItem({ type: "train", data: selected });
    });
    act(() => onRealtime(realtime([makeTrain("live")], 2_000)));

    expect([...live.timetables.keys()].sort()).toEqual(["live", "selected"]);
  });

  it("ignores a realtime response that is not newer than the current one", () => {
    renderProvider();
    const { onRealtime } = pollCallbacks();

    act(() => onRealtime(realtime([makeTrain("a")], 2_000)));
    act(() => onRealtime(realtime([], 1_000)));

    expect(live.trainRealtime.positions.items.map((train) => train.tripId)).toEqual(["a"]);
  });

  it("reports rate limiting before any realtime data has loaded", () => {
    renderProvider();
    const { onError } = pollCallbacks();

    act(() => onError(new Error("HTTP 429")));

    expect(live.trainRealtime.status).toBe("ratelimited");
  });

  it("keeps showing loaded trains when a later poll fails", () => {
    renderProvider();
    const { onRealtime, onError } = pollCallbacks();

    act(() => onRealtime(realtime([makeTrain("a")], 1_000)));
    act(() => onError(new Error("HTTP 500")));

    expect(live.trainRealtime.status).toBe("ready");
    expect(live.trainRealtime.error).toBe("Failed to fetch realtime data");
    expect(live.trainRealtime.positions.items).toHaveLength(1);
  });

  it("does not poll realtime data away from the trains page", () => {
    renderProvider("/about");

    expect(mocks.startRealtimePolling).not.toHaveBeenCalled();
    expect(mocks.stopRealtimePolling).toHaveBeenCalled();
  });
});
