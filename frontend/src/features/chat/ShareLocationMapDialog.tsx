import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { PositionPicker } from "@/components/map/PositionPicker"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Initial lat/lon to centre on; falls back to PositionPicker's default. */
  initialLat?: number | null
  initialLon?: number | null
  /** Called with the picked coords after the user confirms. */
  onConfirm: (lat: number, lon: number) => void
}

/**
 * Modal map dialog used by the composer attachment menu's "Share location
 * on map" action. Wraps the existing PositionPicker component so we keep
 * one Leaflet-handling code path (locate-me button + click-to-drop pin)
 * instead of duplicating its event wiring.
 *
 * The user picks a point by clicking the map (or the "Locate me" button),
 * then confirms; the parent inserts the OSM link snippet into the
 * composer. Closing without confirming is a no-op.
 */
export function ShareLocationMapDialog({
  open,
  onOpenChange,
  initialLat = null,
  initialLon = null,
  onConfirm,
}: Props) {
  const [lat, setLat] = useState<number | null>(initialLat)
  const [lon, setLon] = useState<number | null>(initialLon)

  const handlePick = (la: number, lo: number) => {
    setLat(la)
    setLon(lo)
  }

  const handleConfirm = () => {
    if (lat == null || lon == null) return
    onConfirm(lat, lon)
    onOpenChange(false)
  }

  // Reset the picked point each time we close so reopening starts fresh
  // (or honours a new `initialLat`/`initialLon`).
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setLat(initialLat)
      setLon(initialLon)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share location on map</DialogTitle>
          <DialogDescription>
            Tap the map to drop a pin, or use “Locate me” to use your
            browser GPS, then confirm to insert an OpenStreetMap link.
          </DialogDescription>
        </DialogHeader>
        <PositionPicker lat={lat} lon={lon} onPick={handlePick} />
        {lat != null && lon != null && (
          <div className="text-xs text-muted-foreground tabular-nums">
            Selected: {lat.toFixed(5)}, {lon.toFixed(5)}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={lat == null || lon == null}
          >
            Insert link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
