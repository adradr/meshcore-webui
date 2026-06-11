import { EXTERNAL_TILE_HOSTS } from "@/features/auth/types"

/**
 * True when the active tile URLs point at a known public CDN (e.g.
 * OpenStreetMap, CARTO) rather than the built-in proxy or a self-hosted
 * server. Drives the visibility of the tile-provider privacy disclosure
 * overlay — the proxy routes all requests through the backend so the
 * viewer's IP is never exposed to the CDN, making the warning unnecessary.
 *
 * When auth info hasn't resolved yet, both arguments are `undefined` and we
 * return `false`. Note the configured DEFAULTS (backend `app/core/config.py`,
 * frontend `features/auth/types.ts`) point at external CDNs, so on default
 * config there is a brief loading window where tiles fetch externally before
 * the disclosure appears once `/api/auth/info` resolves. We deliberately do
 * not show the warning speculatively, to avoid flashing it on every load for
 * proxy / self-hosted deployments.
 */
export function tilesAreExternal(
  light: string | undefined,
  dark: string | undefined,
): boolean {
  const urls = [light ?? "", dark ?? ""]
  return urls.some((url) =>
    EXTERNAL_TILE_HOSTS.some((host) => url.includes(host)),
  )
}
