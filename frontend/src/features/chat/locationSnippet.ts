/** Coordinate precision shown in the inserted OSM link — 5 dp ≈ 1.1m,
 *  finer than any consumer GPS and still compact in chat. */
const COORD_DECIMALS = 5

/**
 * Build the human-readable + machine-readable OSM snippet inserted into
 * the composer by the AttachmentMenu's "My current position" and
 * "Share location on map" actions.
 *
 * Format:
 *   📍 47.49790, 19.04020
 *   https://www.openstreetmap.org/?mlat=47.49790123&mlon=19.04020456#map=15/47.49790/19.04020
 *
 * The query-string keeps full original precision (so deep-linkers and
 * downstream parsers don't lose information), while the visible line
 * and the hash are rounded for readability.
 */
export function formatLocationSnippet(lat: number, lon: number): string {
  const la = lat.toFixed(COORD_DECIMALS)
  const lo = lon.toFixed(COORD_DECIMALS)
  return `📍 ${la}, ${lo}\nhttps://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${la}/${lo}`
}
