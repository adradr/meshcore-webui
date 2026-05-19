const EARTH_R_KM = 6371

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Haversine great-circle distance between two (lat,lon) pairs in km. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R_KM * Math.asin(Math.sqrt(a))
}

/** Initial compass bearing from point 1 to point 2, in degrees [0,360). */
export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)
  const dLambda = toRad(lon2 - lon1)
  const y = Math.sin(dLambda) * Math.cos(phi2)
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const

/** 8-point compass direction (N, NE, E, …) for a bearing in degrees. */
export function compassDir(deg: number): string {
  const i = Math.round(deg / 45) % 8
  return COMPASS[i]
}

/**
 * Human-friendly distance formatter:
 *   < 1 km   → "850 m"
 *   < 100 km → "12.4 km"
 *   else     → "1,240 km"
 */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  if (km < 100) return `${km.toFixed(1)} km`
  return `${Math.round(km).toLocaleString()} km`
}
