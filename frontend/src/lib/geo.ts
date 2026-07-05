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
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return { t: 0, distanceSq: (px - ax) ** 2 + (py - ay) ** 2 };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const distanceSq = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
  return { t, distanceSq };
};
