import { useEffect } from "react"
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet"
import type { LeafletMouseEvent } from "leaflet"
import { fixDefaultIcon } from "@/lib/leaflet/fixDefaultIcon"

/**
 * Small map control that lets the user click anywhere to drop a marker
 * and prefill a lat/lon pair. Embedded inside the device PositionCard
 * edit form so map taps and number-input typing stay in sync both
 * directions:
 *  - clicking the map invokes `onPick(lat, lon)` (rounded to 6 dp =
 *    ~10 cm precision, well under any consumer GPS)
 *  - typing in the lat/lon inputs updates this component's `lat`/`lon`
 *    props, which re-positions the marker and re-centers the view
 *
 * Reuses the project-wide `fixDefaultIcon` patch so Leaflet's default
 * marker images resolve correctly under Vite's bundler.
 */

/** Sensible "no GPS yet" centre — middle of Hungary, matches the
 *  default test fixtures (47.5, 19.05) and is roughly central to the
 *  primary MeshCore community area. */
const DEFAULT_CENTER: [number, number] = [47.5, 19.05]
const DEFAULT_ZOOM_NO_FIX = 5
const DEFAULT_ZOOM_WITH_FIX = 13
/** GPS coordinates rounded to 6 decimal places resolve to ~11 cm at
 *  the equator — well below the precision of any consumer-grade GPS,
 *  and short enough to fit comfortably in the lat/lon number inputs. */
const COORD_DECIMALS = 6

interface PositionPickerProps {
  lat: number | null
  lon: number | null
  onPick: (lat: number, lon: number) => void
}

function PickerEvents({
  onPick,
}: {
  onPick: (lat: number, lon: number) => void
}) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onPick(
        Number(e.latlng.lat.toFixed(COORD_DECIMALS)),
        Number(e.latlng.lng.toFixed(COORD_DECIMALS)),
      )
    },
  })
  return null
}

function RecenterWhenCoordsChange({
  lat,
  lon,
}: {
  lat: number | null
  lon: number | null
}) {
  const map = useMap()
  useEffect(() => {
    if (lat == null || lon == null) return
    // Don't force a zoom change here — let the user keep their zoom
    // level if they've already zoomed in. We only re-pan.
    map.panTo([lat, lon], { animate: false })
  }, [map, lat, lon])
  return null
}

export function PositionPicker({ lat, lon, onPick }: PositionPickerProps) {
  // Patch Leaflet's default-icon URLs on first mount; idempotent thanks
  // to the module-level `patched` guard inside fixDefaultIcon.
  fixDefaultIcon()

  const haveCoords = lat != null && lon != null
  const center: [number, number] = haveCoords
    ? [lat, lon]
    : DEFAULT_CENTER
  const zoom = haveCoords ? DEFAULT_ZOOM_WITH_FIX : DEFAULT_ZOOM_NO_FIX

  return (
    <div
      className="overflow-hidden rounded-md border"
      style={{ height: 240 }}
      data-testid="position-picker-map"
    >
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ width: "100%", height: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution="© OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {haveCoords && <Marker position={[lat, lon]} />}
        <PickerEvents onPick={onPick} />
        <RecenterWhenCoordsChange lat={lat} lon={lon} />
      </MapContainer>
    </div>
  )
}
