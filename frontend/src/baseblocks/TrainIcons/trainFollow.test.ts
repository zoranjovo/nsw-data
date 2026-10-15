import { describe, expect, it } from "vitest";
import { followStep, isKeyboardPan, isPinch } from "./trainFollow";

describe("followStep", () => {
  it("snaps straight onto the train when it is only a couple of pixels away", () => {
    expect(followStep(1.5, 16)).toBe(1);
  });

  it("eases further in a longer frame", () => {
    const short = followStep(50, 8);
    const long = followStep(50, 32);

    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
    expect(long).toBeLessThan(1);
  });

  it("does not move for a zero-length frame", () => {
    expect(followStep(50, 0)).toBe(0);
  });
});

describe("isPinch", () => {
  it("treats a two-finger gesture as a pinch", () => {
    expect(isPinch({ type: "touchmove", touches: [{}, {}] } as unknown as Event)).toBe(true);
  });

  it("treats a one-finger drag or a mouse drag as panning", () => {
    expect(isPinch({ type: "touchmove", touches: [{}] } as unknown as Event)).toBe(false);
    expect(isPinch(new MouseEvent("mousemove"))).toBe(false);
    expect(isPinch(undefined)).toBe(false);
  });
});

describe("isKeyboardPan", () => {
  it("treats plain arrow keys as panning", () => {
    expect(isKeyboardPan(new KeyboardEvent("keydown", { key: "ArrowLeft" }))).toBe(true);
  });

  it("ignores shift-arrow rotation, zoom keys and other input", () => {
    expect(isKeyboardPan(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true }))).toBe(
      false
    );
    expect(isKeyboardPan(new KeyboardEvent("keydown", { key: "+" }))).toBe(false);
    expect(isKeyboardPan(new WheelEvent("wheel"))).toBe(false);
    expect(isKeyboardPan(undefined)).toBe(false);
  });
});
