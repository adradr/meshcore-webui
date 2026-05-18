import { useEffect } from "react"
import { useMap } from "react-leaflet"

/**
 * Leaflet renders incorrectly when its container is sized after mount
 * (common with flex layouts or hidden tab panes). We observe the container
 * size and call invalidateSize() whenever it changes.
 */
export function useMapResize(): void {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    const ro = new ResizeObserver(() => {
      map.invalidateSize()
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [map])
}

export function MapResizer() {
  useMapResize()
  return null
}
