export const FOLLOW_MIN_ZOOM = 16;

const FOLLOW_SMOOTHING_MS = 150;
const FOLLOW_SNAP_PX = 2;

// Fraction of the way to move the camera towards the train this frame
export const followStep = (gapPx: number, frameMs: number): number =>
  gapPx <= FOLLOW_SNAP_PX ? 1 : 1 - Math.exp(-Math.max(0, frameMs) / FOLLOW_SMOOTHING_MS);

export const isPinch = (event: Event | undefined): boolean =>
  event != null && "touches" in event && (event as TouchEvent).touches.length > 1;

export const isKeyboardPan = (event: Event | undefined): boolean => {
  if (event == null || !("key" in event)) return false;
  const { key, shiftKey } = event as KeyboardEvent;
  return key.startsWith("Arrow") && !shiftKey;
};
