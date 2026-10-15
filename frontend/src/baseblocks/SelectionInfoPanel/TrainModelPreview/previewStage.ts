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
import { createDestinationDisplay } from "./destinationDisplay";

export type PreviewSettings = {
  focusPoint: readonly [number, number, number];
  cameraDistance: number;
  cameraAzimuthDeg: number;
  cameraElevationDeg: number;
  cameraFovDeg: number;
  screenShiftLeft: number;
  exposure: number;
  maxPixelRatio: number;
};

export type PreviewStage = {
  setYaw: (radians: number) => void;
  setDestination: (destination: TrainDestination) => void;
  render: () => void;
  dispose: () => void;
};

export const createPreviewStage = (
  canvas: HTMLCanvasElement,
  model: Group,
  settings: PreviewSettings
): PreviewStage | null => {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return null;
  }
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

  return {
    setYaw: (radians) => {
      pivot.rotation.y = radians;
    },
    setDestination: (destination) => display?.update(destination),
    render,
    dispose: () => {
      observer.disconnect();
      display?.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
};
