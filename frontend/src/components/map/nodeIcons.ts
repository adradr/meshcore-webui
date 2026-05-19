import L from "leaflet"

export type NodeType = "CLI" | "REP" | "ROOM" | "UNKNOWN" | "SELF"

const COLORS: Record<NodeType, string> = {
  CLI: "#2563eb", // blue-600
  REP: "#16a34a", // green-600
  ROOM: "#ea580c", // orange-600
  UNKNOWN: "#6b7280", // gray-500
  SELF: "#0891b2", // cyan-600 — your own node
}

function svgFor(color: string): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="24" height="32">
      <path d="M12 0c-6.075 0-11 4.925-11 11 0 8.25 11 21 11 21s11-12.75 11-21c0-6.075-4.925-11-11-11z"
            fill="${color}" stroke="white" stroke-width="1.5"/>
      <circle cx="12" cy="11" r="4" fill="white"/>
    </svg>`.trim()
}

/** Larger pulsing marker for your own device — distinct from neighbours. */
function selfSvg(): string {
  const color = COLORS.SELF
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 44" width="36" height="44">
      <circle cx="18" cy="38" r="5" fill="${color}" opacity="0.25">
        <animate attributeName="r" values="5;10;5" dur="2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite"/>
      </circle>
      <path d="M18 0c-7.732 0-14 6.268-14 14 0 10.5 14 28 14 28s14-17.5 14-28c0-7.732-6.268-14-14-14z"
            fill="${color}" stroke="white" stroke-width="2"/>
      <circle cx="18" cy="14" r="5.5" fill="white"/>
      <text x="18" y="17" text-anchor="middle" font-size="7" font-weight="700" fill="${color}" font-family="system-ui, sans-serif">ME</text>
    </svg>`.trim()
}

const iconCache: Partial<Record<NodeType, L.DivIcon>> = {}

export function iconForNodeType(type: NodeType): L.DivIcon {
  const cached = iconCache[type]
  if (cached) return cached
  if (type === "SELF") {
    const icon = L.divIcon({
      className: "mc-marker-wrapper",
      html: `<div class="mc-marker">${selfSvg()}</div>`,
      iconSize: [36, 44],
      iconAnchor: [18, 44],
      popupAnchor: [0, -40],
    })
    iconCache[type] = icon
    return icon
  }
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
