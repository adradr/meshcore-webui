import { useMemo } from "react"
import { MapContainer } from "react-leaflet"
import type { LatLngExpression, LatLngTuple } from "leaflet"
import MarkerClusterGroup from "react-leaflet-cluster"
import { fixDefaultIcon } from "@/lib/leaflet/fixDefaultIcon"
import { ThemedTileLayer } from "./TileLayers"
import { MapResizer } from "./useMapResize"
import { MarkersLayer, type ContactMarker } from "./MarkersLayer"

fixDefaultIcon()

interface Props {
  contacts: ContactMarker[]
  dark?: boolean
}

const DEFAULT_CENTER: LatLngExpression = [47.4979, 19.0402] // Budapest
const DEFAULT_ZOOM = 6

function fitCenter(contacts: ContactMarker[]): {
  center: LatLngExpression
  zoom: number
} {
  if (contacts.length === 0) return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }
  if (contacts.length === 1) {
    return { center: [contacts[0].lat, contacts[0].lon] as LatLngTuple, zoom: 11 }
  }
  const lats = contacts.map((c) => c.lat)
  const lons = contacts.map((c) => c.lon)
  const center: LatLngTuple = [
    (Math.min(...lats) + Math.max(...lats)) / 2,
    (Math.min(...lons) + Math.max(...lons)) / 2,
  ]
  return { center, zoom: 7 }
}

export function ClusteredContactMap({ contacts, dark = false }: Props) {
  const { center, zoom } = useMemo(() => fitCenter(contacts), [contacts])

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom
      className="h-full w-full"
    >
      <ThemedTileLayer dark={dark} />
      <MapResizer />
      <MarkerClusterGroup chunkedLoading>
        <MarkersLayer contacts={contacts} />
      </MarkerClusterGroup>
    </MapContainer>
  )
}
