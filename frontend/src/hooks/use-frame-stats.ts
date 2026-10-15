import { useEffect, useState } from "react";

export type FrameStats = {
  fps: number;
  frameMs: number;
};

const SAMPLE_WINDOW_MS = 1000;

export const useFrameStats = (): FrameStats | null => {
  const [stats, setStats] = useState<FrameStats | null>(null);

  useEffect(() => {
    let frameId: number | null = null;
    let windowStart: number | null = null;
    let lastFrame: number | null = null;
    let frames = 0;
    let frameTimeTotal = 0;

    const onFrame = (now: number) => {
      frameId = requestAnimationFrame(onFrame);
      if (lastFrame != null) {
        frames++;
        frameTimeTotal += now - lastFrame;
      }
      lastFrame = now;
      windowStart ??= now;

      const elapsed = now - windowStart;
      if (elapsed < SAMPLE_WINDOW_MS || frames === 0) return;
      setStats({
        fps: Math.round((frames * 1000) / elapsed),
        frameMs: frameTimeTotal / frames,
      });
      windowStart = now;
      frames = 0;
      frameTimeTotal = 0;
    };

    frameId = requestAnimationFrame(onFrame);
    return () => {
      if (frameId != null) cancelAnimationFrame(frameId);
    };
  }, []);

  return stats;
};
