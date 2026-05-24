import { Marker, Popup } from "react-leaflet"
import { iconForNodeType, type NodeType } from "./nodeIcons"
import { MarkerPopupBody } from "./MarkerPopupBody"

export interface ContactMarker {
  id: string
  name: string
  lat: number
  lon: number
  nodeType: NodeType
}

interface Props {
  contacts: ContactMarker[]
  /** Provided by parent if line-of-sight is available (self has known GPS). */
  onLosRequest?: (c: ContactMarker) => void
  /** When false (self GPS unknown), LoS button is disabled with a helpful tooltip. */
  selfHasGps?: boolean
  /** Emitted when the user clicks "Trace path" on a REP/ROOM popup. */
  onTraceRequest?: (c: ContactMarker) => void
  /**
   * Pubkey of the node whose trace is currently in flight, or `null` when no
   * trace is running. Forwarded to each popup so only the matching node spins
   * and every other Trace button greys out.
   */
  traceInFlightPubkey: string | null
  /** Emitted when the user clicks "Monitor" (continuous trace) on a popup. */
  onMonitorRequest?: (c: ContactMarker) => void
}

export function MarkersLayer({
  contacts,
  onLosRequest,
  selfHasGps,
  onTraceRequest,
  traceInFlightPubkey,
  onMonitorRequest,
}: Props) {
  return (
    <>
      {contacts.map((c) => (
        <Marker
          key={c.id}
          position={[c.lat, c.lon]}
          icon={iconForNodeType(c.nodeType)}
        >
          <Popup>
            <MarkerPopupBody
              contact={c}
              onLosRequest={onLosRequest}
              selfHasGps={selfHasGps}
              isSelf={c.id === "__self__"}
              onTraceRequest={onTraceRequest}
              traceInFlightPubkey={traceInFlightPubkey}
              onMonitorRequest={onMonitorRequest}
            />
          </Popup>
        </Marker>
      ))}
    </>
  )
}
