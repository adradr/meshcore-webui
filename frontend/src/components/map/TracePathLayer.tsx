import { useEffect, useMemo } from "react"
import { Marker, Polyline, Popup } from "react-leaflet"
import L from "leaflet"
import type { TraceHopOut } from "@/features/trace/api"

const TRACE_POLYLINE_OPTIONS = {
  color: "rgb(59, 130, 246)",
  weight: 4,
  opacity: 0.85,
  dashArray: "6 4",
}

type PlottedHop = TraceHopOut & { lat: number; lon: number }

function isPlotted(h: TraceHopOut): h is PlottedHop {
  return typeof h.lat === "number" && typeof h.lon === "number"
}

function hopIcon(index: number): L.DivIcon {
  return L.divIcon({
    className: "mc-trace-hop-icon",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div class="mc-trace-hop">${index}</div>`,
  })
}

export interface TracePathLayerProps {
  hops: TraceHopOut[]
  /** Optional origin point (self device) to start the polyline. */
  origin?: { lat: number; lon: number; name?: string } | null
  /** Called with hops that couldn't be plotted (no GPS). */
  onUnplottedHops?: (unplotted: TraceHopOut[]) => void
}

export function TracePathLayer({
  hops,
  origin,
  onUnplottedHops,
}: TracePathLayerProps) {
  const plotted = useMemo<PlottedHop[]>(() => hops.filter(isPlotted), [hops])
  const unplotted = useMemo<TraceHopOut[]>(
    () => hops.filter((h) => !isPlotted(h)),
    [hops],
  )

  useEffect(() => {
    onUnplottedHops?.(unplotted)
  }, [unplotted, onUnplottedHops])

  const polylinePositions: [number, number][] = [
    ...(origin ? [[origin.lat, origin.lon] as [number, number]] : []),
    ...plotted.map((h) => [h.lat, h.lon] as [number, number]),
  ]

  return (
    <>
      {polylinePositions.length > 1 && (
        <Polyline
          positions={polylinePositions}
          pathOptions={TRACE_POLYLINE_OPTIONS}
        />
      )}
      {plotted.map((h, i) => (
        <Marker
          key={`${h.hash}-${i}`}
          position={[h.lat, h.lon]}
          icon={hopIcon(i + 1)}
        >
          <Popup>
            <div className="space-y-1 min-w-32">
              <div className="text-xs font-semibold">Hop {i + 1}</div>
              <div className="text-sm">
                {h.name ?? `Unknown (${h.hash})`}
              </div>
              <div className="text-xs text-muted-foreground">
                SNR: {h.snr.toFixed(1)} dB
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  )
}
