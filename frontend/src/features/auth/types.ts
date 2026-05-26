import { z } from "zod"

// Default tile URLs served by the backend's built-in tile proxy. The
// proxy caches upstream tiles on disk so the end-user's browser never
// contacts external CDNs. Keep in lockstep with `Settings.tile_url_*`
// in backend/app/core/config.py.
export const DEFAULT_TILE_URL_LIGHT = "/api/tiles/light/{z}/{x}/{y}.png"
export const DEFAULT_TILE_URL_DARK = "/api/tiles/dark/{z}/{x}/{y}.png"
export const DEFAULT_TILE_ATTRIBUTION_LIGHT =
  '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors'
export const DEFAULT_TILE_ATTRIBUTION_DARK =
  '&copy; <a href="https://openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

// Known external tile CDN hostnames. The tile-provider privacy
// disclosure is shown only when an operator overrides the defaults to
// point directly at one of these public services (bypassing the proxy).
export const EXTERNAL_TILE_HOSTS = [
  "tile.openstreetmap.org",
  "basemaps.cartocdn.com",
]

export const AuthInfoSchema = z.object({
  required: z.boolean(),
  valid: z.boolean(),
  // Optional: backend exposes the configured public base URL so the SPA can
  // render shareable attachment links. May be `null` (unset) or absent on
  // older deployments.
  public_base_url: z.string().nullable().optional(),
  // Tile-server overrides. All four are optional so a SPA built against a
  // newer schema still parses cleanly against an older backend deployment
  // that doesn't surface them. When absent, the SPA falls back to the
  // DEFAULT_TILE_* constants above (which match the backend defaults).
  tile_url_light: z.string().optional(),
  tile_url_dark: z.string().optional(),
  tile_attribution_light: z.string().optional(),
  tile_attribution_dark: z.string().optional(),
})
export type AuthInfo = z.infer<typeof AuthInfoSchema>
