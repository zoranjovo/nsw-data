import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  DirectionalLight,
  Group,
  MathUtils,
  NeutralToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { TrainDestination } from "@/lib/trainDestination";
import { loadTrainModel } from "@/lib/trainModels";
import { createDestinationDisplay, type DestinationDisplay } from "./destinationDisplay";
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

type Stage = {
  pivot: Group;
  render: () => void;
  display: DestinationDisplay | null;
};

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
  const [stage, setStage] = useState<Stage | null>(null);

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

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      setStatus("error");
      return;
    }
    const settings = TRAIN_PREVIEW_SETTINGS;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.maxPixelRatio));
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = settings.exposure;

    const scene = new Scene();
    const pmrem = new PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;

    const sun = new DirectionalLight(0xffffff, 1.4);
    sun.position.set(6, 10, -4);
    scene.add(sun);

    const [focusX, focusY, focusZ] = settings.focusPoint;
    const pivot = new Group();
    const train = model.clone(true);
    train.position.set(-focusX, -focusY, -focusZ);
    const display = createDestinationDisplay(train);
    pivot.add(train);
    scene.add(pivot);

    const camera = new PerspectiveCamera(settings.cameraFovDeg, 1, 0.1, 200);
    const azimuth = MathUtils.degToRad(settings.cameraAzimuthDeg);
    const elevation = MathUtils.degToRad(settings.cameraElevationDeg);
    camera.position.set(
      settings.cameraDistance * Math.cos(elevation) * Math.cos(azimuth),
      settings.cameraDistance * Math.sin(elevation),
      settings.cameraDistance * Math.cos(elevation) * Math.sin(azimuth)
    );
    camera.lookAt(0, 0, 0);

    const render = () => renderer.render(scene, camera);

    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.setViewOffset(
        clientWidth,
        clientHeight,
        clientWidth * settings.screenShiftLeft,
        0,
        clientWidth,
        clientHeight
      );
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    setStage({ pivot, render, display });

    return () => {
      observer.disconnect();
      if (spinFrameRef.current != null) cancelAnimationFrame(spinFrameRef.current);
      spinFrameRef.current = null;
      setStage(null);
      display?.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
    };
  }, [model]);

  const { primary, secondary } = destination;
  useEffect(() => {
    if (!stage?.display) return;
    stage.display.update({ primary, secondary });
    stage.render();
  }, [stage, primary, secondary]);

  useEffect(() => {
    if (!isOpen || !stage) return;
    const { pivot, render } = stage;

    const { spinFromDeg, spinDurationMs } = TRAIN_PREVIEW_SETTINGS;
    const startYaw = MathUtils.degToRad(spinFromDeg);
    const startedAt = performance.now();
    if (spinFrameRef.current != null) cancelAnimationFrame(spinFrameRef.current);

    const step = (now: number) => {
      const progress = spinDurationMs > 0 ? Math.min(1, (now - startedAt) / spinDurationMs) : 1;
      pivot.rotation.y = startYaw * (1 - easeOutCubic(progress));
      render();
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
