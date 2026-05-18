import L from "leaflet"

export type NodeType = "CLI" | "REP" | "ROOM" | "UNKNOWN"

const COLORS: Record<NodeType, string> = {
  CLI: "#2563eb", // blue-600
  REP: "#16a34a", // green-600
  ROOM: "#ea580c", // orange-600
  UNKNOWN: "#6b7280", // gray-500
}

function svgFor(color: string): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="24" height="32">
      <path d="M12 0c-6.075 0-11 4.925-11 11 0 8.25 11 21 11 21s11-12.75 11-21c0-6.075-4.925-11-11-11z"
            fill="${color}" stroke="white" stroke-width="1.5"/>
      <circle cx="12" cy="11" r="4" fill="white"/>
    </svg>`.trim()
}

const iconCache: Partial<Record<NodeType, L.DivIcon>> = {}

export function iconForNodeType(type: NodeType): L.DivIcon {
  const cached = iconCache[type]
  if (cached) return cached
  const icon = L.divIcon({
    className: "mc-marker-wrapper",
    html: `<div class="mc-marker">${svgFor(COLORS[type])}</div>`,
    iconSize: [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -28],
  })
  iconCache[type] = icon
  return icon
}
