import { Locate } from "lucide-react"
import { useState } from "react"
import { useMap } from "react-leaflet"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

/**
 * LocatePhoneButton
 *
 * Uses the browser's Geolocation API to pan/zoom the map to the user's
 * phone position. Independent of any MeshCore device — useful when the
 * device's own GPS isn't fixed yet, or when the operator wants to compare
 * the radio's reported location against the phone's.
 *
 * Disabled while a request is in flight to avoid stacked prompts.
 */
export function LocatePhoneButton() {
  const map = useMap()
  const [busy, setBusy] = useState(false)

  const handleClick = () => {
    if (!navigator.geolocation) {
      toast.error("Browser doesn't support geolocation")
      return
    }
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false)
        map.setView(
          [pos.coords.latitude, pos.coords.longitude],
          Math.max(map.getZoom(), 14),
          { animate: true },
        )
      },
      (err) => {
        setBusy(false)
        toast.error(`Location unavailable: ${err.message}`)
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  }

  return (
    <div className="absolute right-3 top-28 z-[1000]">
      <Button
        size="icon"
        variant="secondary"
        className="shadow-md"
        onClick={handleClick}
        disabled={busy}
        title="Locate my phone"
        aria-label="Locate my phone"
      >
        <Locate className="h-4 w-4" />
      </Button>
    </div>
  )
}
