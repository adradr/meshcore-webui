import { TileLayer } from "react-leaflet"
import { useAuthInfo } from "@/features/auth/api"
import {
  DEFAULT_TILE_ATTRIBUTION_DARK,
  DEFAULT_TILE_ATTRIBUTION_LIGHT,
  DEFAULT_TILE_URL_DARK,
  DEFAULT_TILE_URL_LIGHT,
} from "@/features/auth/types"

interface Props {
  dark: boolean
}

/**
 * Render the active Leaflet tile layer. URL templates + attribution come
 * from `GET /api/auth/info` so operators can self-host tiles by setting
 * the `MESHCORE_WEBUI_TILE_URL_*` env vars; when the response is missing
 * (older backend, query not yet resolved) we fall back to the public
 * OpenStreetMap / CARTO defaults so the map never renders blank.
 */
export function ThemedTileLayer({ dark }: Props) {
  const auth = useAuthInfo()
  const lightUrl = auth.data?.tile_url_light ?? DEFAULT_TILE_URL_LIGHT
  const lightAttr =
    auth.data?.tile_attribution_light ?? DEFAULT_TILE_ATTRIBUTION_LIGHT
  const darkUrl = auth.data?.tile_url_dark ?? DEFAULT_TILE_URL_DARK
  const darkAttr =
    auth.data?.tile_attribution_dark ?? DEFAULT_TILE_ATTRIBUTION_DARK

  // `key` forces Leaflet to drop the old TileLayer instance when the
  // template URL changes (e.g. an operator hot-swaps the env var) —
  // react-leaflet doesn't re-issue tiles on a `url` prop change alone.
  return dark ? (
    <TileLayer
      key={darkUrl}
      url={darkUrl}
      attribution={darkAttr}
      subdomains="abcd"
      maxZoom={20}
    />
  ) : (
    <TileLayer
      key={lightUrl}
      url={lightUrl}
      attribution={lightAttr}
      maxZoom={19}
    />
  )
}
