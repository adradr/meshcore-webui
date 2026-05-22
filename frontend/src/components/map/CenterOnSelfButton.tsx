import { Crosshair } from "lucide-react"
import { useMap } from "react-leaflet"
import { Button } from "@/components/ui/button"

interface Props {
  self: { lat: number; lon: number } | null
}

/**
 * CenterOnSelfButton
 *
 * Floats below the "fit all" button. Centers the viewport on the user's
 * own MeshCore device coordinates. Disabled when self has no GPS — there's
 * nothing to center on.
 *
 * Sits at z-[1000] so it remains above Leaflet panes but below tooltips.
 */
export function CenterOnSelfButton({ self }: Props) {
  const map = useMap()
  const disabled = self === null

  const handleClick = () => {
    if (!self) return
    map.setView([self.lat, self.lon], Math.max(map.getZoom(), 14), {
      animate: true,
    })
  }

  return (
    <div className="absolute right-3 top-14 z-[1000]">
      <Button
        size="icon"
        variant="secondary"
        className="shadow-md"
        onClick={handleClick}
        disabled={disabled}
        title={disabled ? "Device location unknown" : "Center on my node"}
        aria-label="Center on my node"
      >
        <Crosshair className="h-4 w-4" />
      </Button>
    </div>
  )
}
