import { MapContainer, Marker, Popup } from "react-leaflet"
import type { LatLngExpression } from "leaflet"
import MarkerClusterGroup from "react-leaflet-cluster"
import { fixDefaultIcon } from "@/lib/leaflet/fixDefaultIcon"
import { ThemedTileLayer } from "./TileLayers"
import { MapResizer } from "./useMapResize"
import { MarkersLayer, type ContactMarker } from "./MarkersLayer"
import { MapViewPersistence } from "./MapViewPersistence"
import { CenterOnContactsButton } from "./CenterOnContactsButton"
import { CenterOnSelfButton } from "./CenterOnSelfButton"
import { LocatePhoneButton } from "./LocatePhoneButton"
import { iconForNodeType } from "./nodeIcons"

fixDefaultIcon()

interface Props {
  contacts: ContactMarker[]
  /** Your own device's position; rendered as a distinct, non-clustered marker. */
  self?: { name: string; lat: number; lon: number } | null
  dark?: boolean
  /** Emitted when the user clicks "Line of sight" in a marker popup. */
  onLosRequest?: (c: ContactMarker) => void
  /** When false (self GPS unknown), the LoS button is rendered disabled. */
  selfHasGps?: boolean
  /** Emitted when the user clicks "Trace path" on a REP/ROOM popup. */
  onTraceRequest?: (c: ContactMarker) => void
  /**
   * Pubkey of the node whose trace is currently in flight, or `null`. The
   * matching popup shows the spinner; every other Trace button is disabled
   * but does not spin.
   */
  traceInFlightPubkey?: string | null
  /**
   * Rendered inside the `<MapContainer>` (after markers, before fit button).
   * Use this to mount react-leaflet overlays like `TracePathLayer` that
   * require Leaflet map context.
   */
  children?: React.ReactNode
}

// Initial center is a sane fallback before MapViewPersistence kicks in —
// either restoring from localStorage or fitting bounds to GPS contacts.
const INITIAL_CENTER: LatLngExpression = [47.4979, 19.0402] // Budapest
const INITIAL_ZOOM = 6

// Halved from the library default (80) so neighbouring city-block nodes
// stay visually separate at mid zoom instead of merging into a cluster.
const CLUSTER_RADIUS_PX = 40

// Don't aggregate at street-level zoom — at this point the user is clearly
// scrutinising individual nodes, not the global map shape.
const DISABLE_CLUSTER_AT_ZOOM = 14

export function ClusteredContactMap({
  contacts,
  self,
  dark = false,
  onLosRequest,
  selfHasGps,
  onTraceRequest,
  traceInFlightPubkey = null,
  children,
}: Props) {
  // Include self in fitBounds + center so the camera respects your own pin
  const allPoints = self
    ? [...contacts, { id: "__self__", name: self.name, lat: self.lat, lon: self.lon, nodeType: "SELF" as const }]
    : contacts

  return (
    <MapContainer
      center={INITIAL_CENTER}
      zoom={INITIAL_ZOOM}
      scrollWheelZoom
      className="h-full w-full"
    >
      <ThemedTileLayer dark={dark} />
      <MapResizer />
      <MapViewPersistence contacts={allPoints} />
      <MarkerClusterGroup
        chunkedLoading
        maxClusterRadius={CLUSTER_RADIUS_PX}
        disableClusteringAtZoom={DISABLE_CLUSTER_AT_ZOOM}
        spiderfyOnMaxZoom={true}
        showCoverageOnHover={false}
      >
        <MarkersLayer
          contacts={contacts}
          onLosRequest={onLosRequest}
          selfHasGps={selfHasGps}
          onTraceRequest={onTraceRequest}
          traceInFlightPubkey={traceInFlightPubkey}
        />
      </MarkerClusterGroup>
      {/* Self marker rendered OUTSIDE the cluster so it always shows distinctly */}
      {self && (
        <Marker position={[self.lat, self.lon]} icon={iconForNodeType("SELF")} zIndexOffset={1000}>
          <Popup>
            <div className="text-sm">
              <div className="font-medium">{self.name} (this device)</div>
              <div className="text-[10px] opacity-60">
                {self.lat.toFixed(5)}, {self.lon.toFixed(5)}
              </div>
            </div>
          </Popup>
        </Marker>
      )}
      <CenterOnContactsButton contacts={allPoints} />
      <CenterOnSelfButton self={self ? { lat: self.lat, lon: self.lon } : null} />
      <LocatePhoneButton />
      {children}
    </MapContainer>
  )
}
