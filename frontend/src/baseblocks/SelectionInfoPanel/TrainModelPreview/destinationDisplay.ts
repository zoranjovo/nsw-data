import {
  CanvasTexture,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  SRGBColorSpace,
} from "three";
import type { TrainDestination } from "@/lib/trainDestination";

export const DESTINATION_DISPLAY_SETTINGS = {
  textureWidth: 1024,
  textColour: "#ff8c1a",
  backgroundColour: "#050302",
  fontFamily: "'Arial Narrow', 'Roboto Condensed', Arial, sans-serif",
  singleLineHeight: 0.62,
  primaryLineHeight: 0.46,
  secondaryLineHeight: 0.32,
  sidePadding: 0.06,
  ledPitch: 0.04,
  ledGap: 0.3,
  ledGridOpacity: 0.45,
};

export type DestinationDisplay = {
  update: (destination: TrainDestination) => void;
  dispose: () => void;
};

const fitFont = (
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  maxWidth: number
): number => {
  const { fontFamily } = DESTINATION_DISPLAY_SETTINGS;
  ctx.font = `bold ${size}px ${fontFamily}`;
  const width = ctx.measureText(text).width;
  const fitted = width > maxWidth ? Math.floor((size * maxWidth) / width) : size;
  ctx.font = `bold ${fitted}px ${fontFamily}`;
  return fitted;
};

const drawDestination = (canvas: HTMLCanvasElement, destination: TrainDestination) => {
  const settings = DESTINATION_DISPLAY_SETTINGS;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  const maxWidth = width * (1 - settings.sidePadding * 2);

  ctx.fillStyle = settings.backgroundColour;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = settings.textColour;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (destination.secondary) {
    fitFont(ctx, destination.primary, height * settings.primaryLineHeight, maxWidth);
    ctx.fillText(destination.primary, width / 2, height * 0.32);
    fitFont(ctx, destination.secondary, height * settings.secondaryLineHeight, maxWidth);
    ctx.fillText(destination.secondary, width / 2, height * 0.74);
  } else {
    fitFont(ctx, destination.primary, height * settings.singleLineHeight, maxWidth);
    ctx.fillText(destination.primary, width / 2, height * 0.53);
  }

  const pitch = Math.max(2, Math.round(height * settings.ledPitch));
  const gap = Math.max(1, Math.round(pitch * settings.ledGap));
  ctx.fillStyle = settings.backgroundColour;
  ctx.globalAlpha = settings.ledGridOpacity;
  for (let x = 0; x < width; x += pitch) ctx.fillRect(x, 0, gap, height);
  for (let y = 0; y < height; y += pitch) ctx.fillRect(0, y, width, gap);
  ctx.globalAlpha = 1;
};

export const findDisplayMesh = (train: Object3D): Mesh | null => {
  const display = train.getObjectByName("DestinationDisplay");
  let mesh: Mesh | null = null;
  display?.traverse((object) => {
    if (!mesh && (object as Mesh).isMesh) mesh = object as Mesh;
  });
  return mesh;
};

const placeholderAspect = (material: MeshStandardMaterial): number => {
  const placeholder = material.map?.image as { width?: number; height?: number } | undefined;
  return placeholder?.width && placeholder?.height ? placeholder.height / placeholder.width : 0.22;
};

export type DestinationMaterial = {
  material: MeshStandardMaterial;
  update: (destination: TrainDestination) => void;
  dispose: () => void;
};

// A copy of the model's display material whose texture can show any destination
export const createDestinationMaterial = (
  original: MeshStandardMaterial,
  textureWidth = DESTINATION_DISPLAY_SETTINGS.textureWidth
): DestinationMaterial => {
  const canvas = document.createElement("canvas");
  canvas.width = textureWidth;
  canvas.height = Math.round(textureWidth * placeholderAspect(original));

  const texture = new CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;

  const material = original.clone();
  material.map = texture;
  material.emissiveMap = texture;
  material.needsUpdate = true;

  return {
    material,
    update: (destination) => {
      drawDestination(canvas, destination);
      texture.needsUpdate = true;
    },
    dispose: () => {
      material.dispose();
      texture.dispose();
    },
  };
};

export const createDestinationDisplay = (train: Object3D): DestinationDisplay | null => {
  const mesh = findDisplayMesh(train);
  if (!mesh || Array.isArray(mesh.material)) return null;

  const original = mesh.material as MeshStandardMaterial;
  const display = createDestinationMaterial(original);
  mesh.material = display.material;

  return {
    update: display.update,
    dispose: () => {
      mesh.material = original as Material;
      display.dispose();
    },
  };
};
