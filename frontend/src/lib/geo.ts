export const METERS_PER_DEGREE = 111_000;

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

export const computeBearing = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1R = (lat1 * Math.PI) / 180;
  const lat2R = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};
