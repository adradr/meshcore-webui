import { Crosshair } from "lucide-react"
import L from "leaflet"
import { useMap } from "react-leaflet"
import { Button } from "@/components/ui/button"

interface Props {
  contacts: { lat: number; lon: number }[]
}

/**
 * CenterOnContactsButton
 *
 * Floating control rendered as a MapContainer child so it can call useMap().
 * On click it fits the viewport to the bounding box of all known-GPS
 * contacts (or recenters on the single contact if there's only one).
 * No-op if there are no contacts with coordinates.
 *
 * Positioned at z-[1000] to sit above Leaflet panes but below tooltips.
 */
export function CenterOnContactsButton({ contacts }: Props) {
  const map = useMap()
  const disabled = contacts.length === 0

  const handleClick = () => {
    if (contacts.length === 0) return
    if (contacts.length === 1) {
      const [c] = contacts
      map.setView([c.lat, c.lon], Math.max(map.getZoom(), 13), { animate: true })
      return
    }
    const bounds = L.latLngBounds(
      contacts.map((c) => [c.lat, c.lon] as [number, number]),
    )
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true })
  }

  return (
    <div className="absolute right-3 top-3 z-[1000]">
      <Button
        size="icon"
        variant="secondary"
        className="shadow-md"
        onClick={handleClick}
        disabled={disabled}
        title={disabled ? "No contacts with GPS" : "Center on contacts"}
        aria-label="Center on contacts"
      >
        <Crosshair className="h-4 w-4" />
      </Button>
    </div>
  )
}
