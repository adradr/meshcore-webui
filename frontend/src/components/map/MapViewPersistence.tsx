import { useEffect, useRef } from "react"
import { useMap, useMapEvents } from "react-leaflet"
import L from "leaflet"

const STORAGE_KEY = "meshcore-map-view"

interface Props {
  /** GPS-known contacts used to compute fitBounds on first load. */
  contacts: { lat: number; lon: number }[]
}

/**
 * MapViewPersistence
 *
 * On mount: restore center+zoom from localStorage, falling back to
 * fitBounds(contacts) if no saved view is available. Subsequent user
 * pan/zoom (`moveend`) writes the view back to localStorage so the next
 * visit lands the user exactly where they left off.
 *
 * Designed as a render-less child of <MapContainer>.
 */
export function MapViewPersistence({ contacts }: Props) {
  const map = useMap()
  const restoredRef = useRef(false)

  useEffect(() => {
    if (restoredRef.current) return

    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(STORAGE_KEY)
        : null
    if (raw) {
      try {
        const { lat, lon, zoom } = JSON.parse(raw)
        if (
          typeof lat === "number" &&
          typeof lon === "number" &&
          typeof zoom === "number"
        ) {
          map.setView([lat, lon], zoom, { animate: false })
          restoredRef.current = true
          return
        }
      } catch {
        // fall through to bounds-fit
      }
    }

    if (contacts.length > 0) {
      const bounds = L.latLngBounds(
        contacts.map((c) => [c.lat, c.lon] as [number, number]),
      )
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 })
      restoredRef.current = true
    }
  }, [map, contacts])

  useMapEvents({
    moveend: () => {
      const c = map.getCenter()
      const z = map.getZoom()
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ lat: c.lat, lon: c.lng, zoom: z }),
        )
      } catch {
        // localStorage may be disabled (Safari private mode); silently ignore.
      }
    },
  })

  return null
}
