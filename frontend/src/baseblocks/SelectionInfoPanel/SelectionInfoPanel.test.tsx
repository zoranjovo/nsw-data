import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, LiveTrainData, SelectedItem } from "@/providers/AppProvider";
import { makeLiveTrainData, makeRealtime, makeTrain } from "@/test/fixtures";
import type { TrainPosition } from "@/types/train/train";
import { SelectionInfoPanel } from "./SelectionInfoPanel";

const mocks = vi.hoisted(() => ({
  selectedItem: null as unknown,
  setSelectedItem: vi.fn(),
  live: null as unknown as LiveTrainData,
}));

vi.mock("@/providers/AppProvider", () => ({
  useAppContext: () =>
    ({
      selectedItem: mocks.selectedItem as SelectedItem,
      setSelectedItem: mocks.setSelectedItem,
      trainStatic: {
        status: "ready",
        tracks: { type: "FeatureCollection", name: "train-tracks", features: [] },
        stops: [],
        error: null,
      },
    }) as unknown as AppState,
  useLiveTrainData: () => mocks.live,
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

vi.mock("./TripTimeline/TripTimeline", () => ({
  TripTimeline: ({ tripId }: { tripId: string }) => <div data-testid="timeline">{tripId}</div>,
}));

const select = (train: TrainPosition | null) => {
  mocks.selectedItem = train ? { type: "train", data: train } : null;
};

const panel = () => document.querySelector("aside");

const renderPanel = () => {
  const view = render(<SelectionInfoPanel />);
  return { rerender: () => view.rerender(<SelectionInfoPanel />) };
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.live = makeLiveTrainData();
  mocks.setSelectedItem.mockReset();
  select(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SelectionInfoPanel", () => {
  it("opens straight away on the first selected train", () => {
    select(makeTrain("a"));
    renderPanel();

    expect(panel()?.dataset.open).toBe("true");
    expect(screen.getByText("Train a")).toBeTruthy();
    expect(screen.getByTestId("timeline").textContent).toBe("a");
  });

  it("closes the current train before showing a newly selected one", () => {
    select(makeTrain("a"));
    const { rerender } = renderPanel();

    select(makeTrain("b"));
    rerender();

    expect(panel()?.dataset.open).toBe("false");
    expect(screen.getByText("Train a")).toBeTruthy();

    act(() => vi.advanceTimersByTime(280));

    expect(panel()?.dataset.open).toBe("true");
    expect(screen.getByText("Train b")).toBeTruthy();
    expect(screen.queryByText("Train a")).toBeNull();
  });

  it("shows the last train picked when the selection changes mid-transition", () => {
    select(makeTrain("a"));
    const { rerender } = renderPanel();

    select(makeTrain("b"));
    rerender();
    act(() => vi.advanceTimersByTime(100));
    select(makeTrain("c"));
    rerender();
    act(() => vi.advanceTimersByTime(180));

    expect(screen.getByText("Train c")).toBeTruthy();
    expect(screen.queryByText("Train b")).toBeNull();
  });

  it("follows live updates for the displayed train without a transition", () => {
    const train = makeTrain("a", { speed: 10 });
    select(train);
    const { rerender } = renderPanel();

    mocks.live = makeLiveTrainData({ trainRealtime: makeRealtime([{ ...train, speed: 20 }]) });
    select({ ...train, speed: 20 });
    rerender();

    expect(panel()?.dataset.open).toBe("true");
    expect(screen.getByText("72 km/h")).toBeTruthy();
  });

  it("closes when the selection is cleared", () => {
    select(makeTrain("a"));
    const { rerender } = renderPanel();

    select(null);
    rerender();

    expect(panel()?.dataset.open).toBe("false");
  });

  it("clears the selection from the close button", () => {
    select(makeTrain("a"));
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Close selection panel" }));

    expect(mocks.setSelectedItem).toHaveBeenCalledWith(null);
  });

  it("hides raw data again after switching trains", () => {
    select(makeTrain("a"));
    const { rerender } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Raw data" }));
    expect(screen.getByText("Hide raw")).toBeTruthy();

    select(makeTrain("b"));
    rerender();
    act(() => vi.advanceTimersByTime(280));

    expect(screen.getByText("Raw data")).toBeTruthy();
  });
});
