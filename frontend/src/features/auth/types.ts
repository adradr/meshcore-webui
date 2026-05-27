import { z } from "zod"

// Default tile URLs — public CDNs, fast and reliable since the browser
// fetches directly. Keep in lockstep with `Settings.tile_url_*` in
// backend/app/core/config.py. Operators who want privacy can switch to
// the built-in proxy (`/api/tiles/…`) or a self-hosted tile server.
export const DEFAULT_TILE_URL_LIGHT =
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
export const DEFAULT_TILE_URL_DARK =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
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
