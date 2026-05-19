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
}

export function MarkersLayer({ contacts, onLosRequest, selfHasGps }: Props) {
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
            />
          </Popup>
        </Marker>
      ))}
    </>
  )
}
