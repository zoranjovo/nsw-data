import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Group } from "three";
import type { TrainDestination } from "@/lib/trainDestination";
import { loadTrainModel } from "@/lib/trainModels";
import type { PreviewStage } from "./previewStage";
import styles from "./TrainModelPreview.module.css";

// Models are in metres with the cab facing +X and the origin at rail height under the car's centre
export const TRAIN_PREVIEW_SETTINGS = {
  focusPoint: [7, 1.7, 0] as const,
  cameraDistance: 18,
  cameraAzimuthDeg: -47,
  cameraElevationDeg: 8,
  cameraFovDeg: 20,
  screenShiftLeft: 0.03,
  spinFromDeg: -16,
  spinDurationMs: 800,
  exposure: 1.15,
  maxPixelRatio: 2,
};

type Status = "loading" | "ready" | "error";

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export const TrainModelPreview = ({
  fleetCode,
  destination,
  isOpen,
  children,
}: {
  fleetCode: string | null | undefined;
  destination: TrainDestination;
  isOpen: boolean;
  children?: ReactNode;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spinFrameRef = useRef<number | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [model, setModel] = useState<Group | null>(null);
  const [stage, setStage] = useState<PreviewStage | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setModel(null);
    loadTrainModel(fleetCode)
      .then(({ scene }) => {
        if (cancelled) return;
        setModel(scene);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [fleetCode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !model) return;

    let cancelled = false;
    let created: PreviewStage | null = null;
    import("./previewStage")
      .then(({ createPreviewStage }) => {
        if (cancelled) return;
        created = createPreviewStage(canvas, model, TRAIN_PREVIEW_SETTINGS);
        if (created) setStage(created);
        else setStatus("error");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      if (spinFrameRef.current != null) cancelAnimationFrame(spinFrameRef.current);
      spinFrameRef.current = null;
      setStage(null);
      created?.dispose();
    };
  }, [model]);

  const { primary, secondary } = destination;
  useEffect(() => {
    if (!stage) return;
    stage.setDestination({ primary, secondary });
    stage.render();
  }, [stage, primary, secondary]);

  useEffect(() => {
    if (!isOpen || !stage) return;
    const { spinFromDeg, spinDurationMs } = TRAIN_PREVIEW_SETTINGS;
    const startYaw = (spinFromDeg * Math.PI) / 180;
    const startedAt = performance.now();
    if (spinFrameRef.current != null) cancelAnimationFrame(spinFrameRef.current);

    const step = (now: number) => {
      const progress = spinDurationMs > 0 ? Math.min(1, (now - startedAt) / spinDurationMs) : 1;
      stage.setYaw(startYaw * (1 - easeOutCubic(progress)));
      stage.render();
      spinFrameRef.current = progress < 1 ? requestAnimationFrame(step) : null;
    };
    spinFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (spinFrameRef.current != null) cancelAnimationFrame(spinFrameRef.current);
      spinFrameRef.current = null;
    };
  }, [isOpen, stage]);

  return (
    <div className={styles.preview} data-status={status}>
      {status !== "error" && (
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label="3D model of the train"
        />
      )}
      {children && <div className={styles.overlay}>{children}</div>}
    </div>
  );
};
