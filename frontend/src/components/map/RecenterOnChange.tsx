import { useEffect } from "react"
import { useMap } from "react-leaflet"
import type { LatLngExpression } from "leaflet"

interface Props {
  center: LatLngExpression | null
  zoom?: number
}

/**
 * Recenter the map view whenever the external `center` prop changes.
 * Pass null to skip recentering.
 */
export function RecenterOnChange({ center, zoom }: Props) {
  const map = useMap()
  useEffect(() => {
    if (!center) return
    if (zoom != null) map.setView(center, zoom)
    else map.panTo(center)
  }, [map, center, zoom])
  return null
}
