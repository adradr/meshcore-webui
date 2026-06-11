import { useState } from "react"
import { NODE_TYPE_PALETTE, type NodeType } from "./nodeIcons"

const STORAGE_KEY = "meshcore.map.legend.open"

/**
 * Read the persisted open/collapsed state for the legend. Defaults to OPEN
 * if missing, invalid, or localStorage is unavailable (SSR / private mode).
 */
function readPersistedOpen(): boolean {
  if (typeof window === "undefined") return true
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return true
    const parsed = JSON.parse(raw)
    return typeof parsed === "boolean" ? parsed : true
  } catch {
    return true
  }
}

function writePersistedOpen(value: boolean): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // ignore — quota / private mode
  }
}

// Render in the order the user is most likely to look up:
// own marker first, then the three real node types, then unknown.
const ORDERED_TYPES: NodeType[] = ["SELF", "CLI", "REP", "ROOM", "UNKNOWN"]

/**
 * Bottom-left legend overlay for `ClusteredContactMap`. Sits above the
 * Leaflet tile layer (z-index 1000, same band as Leaflet's own controls)
 * and persists its collapsed state to localStorage.
 *
 * Pure DOM — does NOT use `react-leaflet` hooks, so it can be mounted as
 * a sibling of `<MapContainer>` OR inside it; we render it inside so it
 * inherits the map's positioning context.
 */
export function MapLegend() {
  // Lazy initializer: read localStorage once on first render only —
  // subsequent renders don't re-read storage.
  const [open, setOpen] = useState<boolean>(() => readPersistedOpen())

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev
      writePersistedOpen(next)
      return next
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label="Show legend"
        aria-expanded={false}
        className="absolute bottom-3 left-3 z-[1000] rounded-full border bg-popover/95 px-3 py-1 text-xs font-medium shadow-md ring-1 ring-foreground/10 backdrop-blur-sm hover:bg-popover"
        data-testid="map-legend-toggle"
      >
        Legend
      </button>
    )
  }

  return (
    <div
      className="absolute bottom-3 left-3 z-[1000] rounded-md border bg-popover/95 p-2 text-xs shadow-md ring-1 ring-foreground/10 backdrop-blur-sm"
      data-testid="map-legend"
    >
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="font-medium">Legend</span>
        <button
          type="button"
          onClick={toggle}
          aria-label="Collapse legend"
          aria-expanded={true}
          className="-mr-1 -mt-0.5 rounded px-1 text-foreground/60 hover:bg-foreground/10 hover:text-foreground"
          data-testid="map-legend-toggle"
        >
          {"×"}
        </button>
      </div>
      <ul className="space-y-1">
        {ORDERED_TYPES.map((type) => {
          const entry = NODE_TYPE_PALETTE[type]
          return (
            <li key={type} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block rounded-sm ring-1 ring-foreground/20"
                style={{ width: 10, height: 10, backgroundColor: entry.color }}
                data-testid={`legend-swatch-${type}`}
              />
              <span>{entry.label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
