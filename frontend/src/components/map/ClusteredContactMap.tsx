import { MapContainer } from "react-leaflet"
import type { LatLngExpression } from "leaflet"
import MarkerClusterGroup from "react-leaflet-cluster"
import { fixDefaultIcon } from "@/lib/leaflet/fixDefaultIcon"
import { ThemedTileLayer } from "./TileLayers"
import { MapResizer } from "./useMapResize"
import { MarkersLayer, type ContactMarker } from "./MarkersLayer"
import { MapViewPersistence } from "./MapViewPersistence"
import { CenterOnContactsButton } from "./CenterOnContactsButton"

fixDefaultIcon()

interface Props {
  contacts: ContactMarker[]
  dark?: boolean
}

// Initial center is a sane fallback before MapViewPersistence kicks in —
// either restoring from localStorage or fitting bounds to GPS contacts.
const INITIAL_CENTER: LatLngExpression = [47.4979, 19.0402] // Budapest
const INITIAL_ZOOM = 6

export function ClusteredContactMap({ contacts, dark = false }: Props) {
  return (
    <MapContainer
      center={INITIAL_CENTER}
      zoom={INITIAL_ZOOM}
      scrollWheelZoom
      className="h-full w-full"
    >
      <ThemedTileLayer dark={dark} />
      <MapResizer />
      <MapViewPersistence contacts={contacts} />
      <MarkerClusterGroup chunkedLoading>
        <MarkersLayer contacts={contacts} />
      </MarkerClusterGroup>
      <CenterOnContactsButton contacts={contacts} />
    </MapContainer>
  )
}
