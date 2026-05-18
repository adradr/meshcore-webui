/**
 * Vite ships Leaflet's default marker images via static asset URLs. Without this
 * fix, Leaflet tries to resolve the icon URLs relative to the bundled JS chunk,
 * which produces 404s. We import the three marker assets through Vite and
 * patch the icon options once at module load time.
 */
import L from "leaflet"
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png"
import iconUrl from "leaflet/dist/images/marker-icon.png"
import shadowUrl from "leaflet/dist/images/marker-shadow.png"

type IconDefaultProto = L.Icon.Default & { _getIconUrl?: unknown }

let patched = false

export function fixDefaultIcon(): void {
  if (patched) return
  patched = true
  const proto = L.Icon.Default.prototype as IconDefaultProto
  delete proto._getIconUrl
  L.Icon.Default.mergeOptions({
    iconRetinaUrl,
    iconUrl,
    shadowUrl,
  })
}
