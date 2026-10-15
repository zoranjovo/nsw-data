import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFrameStats } from "./use-frame-stats";

let pending: FrameRequestCallback[] = [];

const runFrames = (count: number, frameMs: number, startAt: number) => {
  for (let i = 0; i < count; i++) {
    const callbacks = pending;
    pending = [];
    act(() => {
      for (const callback of callbacks) callback(startAt + i * frameMs);
    });
  }
};

beforeEach(() => {
  pending = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    pending = [];
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useFrameStats", () => {
  it("reports nothing until a full second has been sampled", () => {
    const { result } = renderHook(() => useFrameStats());

    runFrames(30, 16, 0);

    expect(result.current).toBeNull();
  });

  it("reports frames per second and the average frame time once per second", () => {
    const { result } = renderHook(() => useFrameStats());

    runFrames(41, 25, 0);

    expect(result.current?.fps).toBe(40);
    expect(result.current?.frameMs).toBeCloseTo(25);
  });
});
