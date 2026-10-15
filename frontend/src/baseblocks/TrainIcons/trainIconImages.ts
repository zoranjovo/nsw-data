// Greyscale so the line colour can be multiplied in when drawing
const BODY_GRADIENT_STOPS: [number, string][] = [
  [0, "rgb(255, 255, 255)"],
  [0.4, "rgb(228, 228, 228)"],
  [1, "rgb(150, 150, 150)"],
];

const DELAY_COLORS = ["#ffe014", "#ff2d2d"] as const;

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

type ShapeSpec = {
  trace: () => void;
  gradientFrom: [number, number];
  gradientTo: [number, number];
  shade?: () => void;
  highlight?: () => void;
  delayDot: [x: number, y: number, radius: number];
};

const drawUnder = (
  ctx: CanvasRenderingContext2D,
  size: number,
  style: IconStyle,
  shape: ShapeSpec
) => {
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
};

const drawBody = (ctx: CanvasRenderingContext2D, size: number, shape: ShapeSpec) => {
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

  shape.shade?.();
};

const drawOver = (ctx: CanvasRenderingContext2D, style: IconStyle, shape: ShapeSpec) => {
  shape.highlight?.();

  shape.trace();
  ctx.strokeStyle = style.borderColor;
  ctx.lineWidth = style.borderWidth;
  ctx.lineJoin = "round";
  ctx.stroke();
};

const drawDelayDot = (
  ctx: CanvasRenderingContext2D,
  size: number,
  shape: ShapeSpec,
  color: string
) => {
  const [x, y, radius] = shape.delayDot;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = Math.max(2, size * 0.09);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,1)";
  ctx.lineWidth = Math.max(1, size * 0.035);
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

  const shade = () => {
    ctx.beginPath();
    ctx.moveTo(cx, pad);
    ctx.lineTo(size - pad, size - pad);
    ctx.lineTo(cx, notchY);
    ctx.closePath();
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fill();
  };

  const highlight = () => {
    ctx.beginPath();
    ctx.moveTo(cx * 0.92, pad + size * 0.08);
    ctx.lineTo(pad + size * 0.06, size - pad - size * 0.08);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = Math.max(0.5, size * 0.016);
    ctx.stroke();
  };

  return {
    trace,
    gradientFrom: [cx, pad],
    gradientTo: [cx, size - pad],
    shade,
    highlight,
    delayDot: [cx, size * 0.76, size * 0.16],
  };
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

  return {
    trace,
    gradientFrom: [cx, cy - radius],
    gradientTo: [cx, cy + radius],
    delayDot: [size * 0.75, size * 0.75, size * 0.16],
  };
};

// Atlas columns, left to right
export const TRAIN_ICON_COLUMNS = {
  arrow: 0,
  arrowSelected: 1,
  dot: 2,
  dotSelected: 3,
} as const;

// Atlas rows, top to bottom: drawn under the body, the tintable body, drawn over it, then delay dots
export const TRAIN_ICON_ROWS = {
  under: 0,
  body: 1,
  over: 2,
  firstDelay: 3,
} as const;

const ICON_VARIANTS: [
  shape: (ctx: CanvasRenderingContext2D, size: number) => ShapeSpec,
  style: (size: number) => IconStyle,
][] = [
  [arrowShape, unselectedStyle],
  [arrowShape, selectedStyle],
  [dotShape, unselectedStyle],
  [dotShape, selectedStyle],
];

export const TRAIN_ICON_COLUMN_COUNT = ICON_VARIANTS.length;
export const TRAIN_ICON_ROW_COUNT = TRAIN_ICON_ROWS.firstDelay + DELAY_COLORS.length;

export const drawTrainIconAtlas = (cellSize: number, gutter: number): HTMLCanvasElement => {
  const stride = cellSize + gutter * 2;
  const atlas = document.createElement("canvas");
  atlas.width = stride * TRAIN_ICON_COLUMN_COUNT;
  atlas.height = stride * TRAIN_ICON_ROW_COUNT;
  const atlasCtx = atlas.getContext("2d");
  if (!atlasCtx) throw new Error("2D canvas context unavailable");

  const cell = document.createElement("canvas");
  cell.width = cellSize;
  cell.height = cellSize;
  const ctx = cell.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const layers: ((shape: ShapeSpec, style: IconStyle) => void)[] = [
    (shape, style) => drawUnder(ctx, cellSize, style, shape),
    (shape) => drawBody(ctx, cellSize, shape),
    (shape, style) => drawOver(ctx, style, shape),
    ...DELAY_COLORS.map((color) => (shape: ShapeSpec) => drawDelayDot(ctx, cellSize, shape, color)),
  ];

  ICON_VARIANTS.forEach(([makeShape, makeStyle], column) => {
    const shape = makeShape(ctx, cellSize);
    const style = makeStyle(cellSize);
    layers.forEach((draw, row) => {
      ctx.clearRect(0, 0, cellSize, cellSize);
      draw(shape, style);
      atlasCtx.drawImage(cell, column * stride + gutter, row * stride + gutter);
    });
  });
  return atlas;
};
