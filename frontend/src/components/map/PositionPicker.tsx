import { useEffect, useRef, useState } from "react"
import { Crosshair } from "lucide-react"
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet"
import L, { type LeafletMouseEvent } from "leaflet"
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

/** On-map "Locate me" overlay. Triggers geolocation, calls onPick to update
 * the parent's lat/lon state (which also moves the marker via the standard
 * controlled-prop path), and zooms the map in close so the chosen spot is
 * actually visible. Stops click propagation so tapping the button does NOT
 * also drop a marker at the underlying map coords. */
function LocateMeButton({
  onPick,
}: {
  onPick: (lat: number, lon: number) => void
}) {
  const map = useMap()
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)

  // Leaflet listens for click/mousedown on the map container; if we don't
  // stop propagation, hitting the button would also trigger PickerEvents.
  useEffect(() => {
    if (!ref.current) return
    L.DomEvent.disableClickPropagation(ref.current)
    L.DomEvent.disableScrollPropagation(ref.current)
  }, [])

  const locate = () => {
    if (!("geolocation" in navigator)) return
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = Number(pos.coords.latitude.toFixed(COORD_DECIMALS))
        const lo = Number(pos.coords.longitude.toFixed(COORD_DECIMALS))
        onPick(la, lo)
        // setView pans AND zooms — without this, panning from the
        // continental default centre to e.g. a city is invisible because
        // the new spot is far off-screen at zoom 5.
        map.setView([la, lo], DEFAULT_ZOOM_WITH_FIX, { animate: true })
        setBusy(false)
      },
      () => {
        setBusy(false)
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    )
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={locate}
      disabled={busy}
      aria-label="Locate me"
      className="absolute right-2 top-2 z-[1000] inline-flex items-center gap-1 rounded-md border border-border bg-background/95 px-2 py-1 text-xs font-medium shadow-sm backdrop-blur hover:bg-accent disabled:opacity-50"
    >
      <Crosshair className="h-3.5 w-3.5" />
      {busy ? "Locating…" : "Locate me"}
    </button>
  )
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
      className="relative overflow-hidden rounded-md border"
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
        <LocateMeButton onPick={onPick} />
      </MapContainer>
    </div>
  )
}
