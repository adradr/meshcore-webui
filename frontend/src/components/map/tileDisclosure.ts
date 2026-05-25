import {
  DEFAULT_TILE_URL_DARK,
  DEFAULT_TILE_URL_LIGHT,
} from "@/features/auth/types"

/**
 * True when the active tile templates match the public OpenStreetMap /
 * CARTO defaults, i.e. the operator has NOT swapped in a self-hosted
 * tile server. Drives the visibility of the tile-provider privacy
 * disclosure overlay — once an override is in place the warning is
 * misleading, so we hide it. Treat "auth-info not yet resolved" as
 * defaults too: better to over-disclose for the first paint than to
 * silently elide the warning forever if /api/auth/info is slow.
 */
export function tilesAreDefault(
  light: string | undefined,
  dark: string | undefined,
): boolean {
  const effectiveLight = light ?? DEFAULT_TILE_URL_LIGHT
  const effectiveDark = dark ?? DEFAULT_TILE_URL_DARK
  return (
    effectiveLight === DEFAULT_TILE_URL_LIGHT &&
    effectiveDark === DEFAULT_TILE_URL_DARK
  )
}
