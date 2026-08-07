const METERS_PER_DEGREE = 111_000;

export const approxDistanceMeters = (
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number
): number => {
  const dy = (toLatitude - fromLatitude) * METERS_PER_DEGREE;
  const cosLat = Math.cos((fromLatitude * Math.PI) / 180);
  const dx = (toLongitude - fromLongitude) * METERS_PER_DEGREE * cosLat;
  return Math.hypot(dx, dy);
};

const segmentProjectionT = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  return Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
};

const distanceSqAtT = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  t: number
): number => (px - (ax + t * (bx - ax))) ** 2 + (py - (ay + t * (by - ay))) ** 2;

export const pointToSegmentDistSq = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number => distanceSqAtT(px, py, ax, ay, bx, by, segmentProjectionT(px, py, ax, ay, bx, by));

export type ClosestPointOnSegment = {
  t: number;
  distanceSq: number;
};

export const closestPointOnSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): ClosestPointOnSegment => {
  const t = segmentProjectionT(px, py, ax, ay, bx, by);
  return { t, distanceSq: distanceSqAtT(px, py, ax, ay, bx, by, t) };
};
