import type { Map as MaplibreMap } from "maplibre-gl";

export const TRAIN_ICON_IDS = {
  arrow: "train-arrow",
  arrowSelected: "train-arrow-selected",
  dot: "train-dot",
  dotSelected: "train-dot-selected",
} as const;

const ICON_SIZE_PX = 48;

const BODY_GRADIENT_STOPS: [number, string][] = [
  [0, "rgb(218, 228, 100)"],
  [0.4, "rgb(196, 210, 45)"],
  [1, "rgb(118, 128, 28)"],
];

type IconStyle = {
  shadowColor: string;
  borderColor: string;
  borderWidth: number;
  glowLayers?: [string, number][];
};

const unselectedStyle = (size: number): IconStyle => ({
  shadowColor: "rgba(0,0,0,0.22)",
  borderColor: "rgba(255,255,255,0.95)",
  borderWidth: Math.max(1, size * 0.03),
});

const selectedStyle = (size: number): IconStyle => ({
  shadowColor: "rgba(0,0,0,0.3)",
  borderColor: "rgba(255,255,255,1)",
  borderWidth: Math.max(2, size * 0.065),
  glowLayers: [
    ["rgba(56, 189, 248, 0.18)", size * 0.18],
    ["rgba(56, 189, 248, 0.32)", size * 0.12],
    ["rgba(56, 189, 248, 0.55)", size * 0.07],
  ],
});

type TracePath = () => void;

type ShapeSpec = {
  trace: TracePath;
  gradientFrom: [number, number];
  gradientTo: [number, number];
  decorate?: () => void;
};

const drawShape = (
  ctx: CanvasRenderingContext2D,
  size: number,
  style: IconStyle,
  shape: ShapeSpec
): void => {
  ctx.clearRect(0, 0, size, size);

  if (style.glowLayers) {
    for (const [color, lineWidth] of style.glowLayers) {
      shape.trace();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }

  ctx.save();
  ctx.translate(size * 0.04, size * 0.06);
  ctx.fillStyle = style.shadowColor;
  shape.trace();
  ctx.fill();
  ctx.restore();

  ctx.save();
  shape.trace();
  ctx.clip();
  const bodyGrad = ctx.createLinearGradient(
    shape.gradientFrom[0],
    shape.gradientFrom[1],
    shape.gradientTo[0],
    shape.gradientTo[1]
  );
  for (const [offset, color] of BODY_GRADIENT_STOPS) {
    bodyGrad.addColorStop(offset, color);
  }
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  shape.decorate?.();

  shape.trace();
  ctx.strokeStyle = style.borderColor;
  ctx.lineWidth = style.borderWidth;
  ctx.lineJoin = "round";
  ctx.stroke();
};

const arrowShape = (ctx: CanvasRenderingContext2D, size: number): ShapeSpec => {
  const cx = size / 2;
  const pad = size * 0.1;
  const notchY = size * 0.59;

  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(cx, pad);
    ctx.lineTo(size - pad, size - pad);
    ctx.lineTo(cx, notchY);
    ctx.lineTo(pad, size - pad);
    ctx.closePath();
  };

  const decorate = () => {
    ctx.beginPath();
    ctx.moveTo(cx, pad);
    ctx.lineTo(size - pad, size - pad);
    ctx.lineTo(cx, notchY);
    ctx.closePath();
    ctx.fillStyle = "rgba(72, 78, 16, 0.42)";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx * 0.92, pad + size * 0.08);
    ctx.lineTo(pad + size * 0.06, size - pad - size * 0.08);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = Math.max(0.5, size * 0.016);
    ctx.stroke();
  };

  return { trace, gradientFrom: [cx, pad], gradientTo: [cx, size - pad], decorate };
};

const dotShape = (ctx: CanvasRenderingContext2D, size: number): ShapeSpec => {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.3;

  const trace = () => {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();
  };

  return { trace, gradientFrom: [cx, cy - radius], gradientTo: [cx, cy + radius] };
};

const toImageData = (size: number, draw: (ctx: CanvasRenderingContext2D) => void): ImageData => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable");
  }
  draw(ctx);
  return ctx.getImageData(0, 0, size, size);
};

const IMAGE_FACTORIES: Record<string, (size: number) => ImageData> = {
  [TRAIN_ICON_IDS.arrow]: (size) =>
    toImageData(size, (ctx) => drawShape(ctx, size, unselectedStyle(size), arrowShape(ctx, size))),
  [TRAIN_ICON_IDS.arrowSelected]: (size) =>
    toImageData(size, (ctx) => drawShape(ctx, size, selectedStyle(size), arrowShape(ctx, size))),
  [TRAIN_ICON_IDS.dot]: (size) =>
    toImageData(size, (ctx) => drawShape(ctx, size, unselectedStyle(size), dotShape(ctx, size))),
  [TRAIN_ICON_IDS.dotSelected]: (size) =>
    toImageData(size, (ctx) => drawShape(ctx, size, selectedStyle(size), dotShape(ctx, size))),
};

export const registerTrainIconImages = (map: MaplibreMap, size = ICON_SIZE_PX): void => {
  const pixelSize = Math.round(size * Math.max(1, window.devicePixelRatio || 1));
  for (const [iconId, createImage] of Object.entries(IMAGE_FACTORIES)) {
    if (map.hasImage(iconId)) continue;
    map.addImage(iconId, createImage(pixelSize), { sdf: false, pixelRatio: pixelSize / size });
  }
};
