import { Marker, Popup } from "react-leaflet"
import { iconForNodeType, type NodeType } from "./nodeIcons"

export interface ContactMarker {
  id: string
  name: string
  lat: number
  lon: number
  nodeType: NodeType
}

interface Props {
  contacts: ContactMarker[]
}

export function MarkersLayer({ contacts }: Props) {
  return (
    <>
      {contacts.map((c) => (
        <Marker
          key={c.id}
          position={[c.lat, c.lon]}
          icon={iconForNodeType(c.nodeType)}
        >
          <Popup>
            <div className="text-sm">
              <div className="font-medium">{c.name}</div>
              <div className="text-xs opacity-70">{c.nodeType}</div>
              <div className="text-[10px] opacity-60">
                {c.lat.toFixed(5)}, {c.lon.toFixed(5)}
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  )
}
