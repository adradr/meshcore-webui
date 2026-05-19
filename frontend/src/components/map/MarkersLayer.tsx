import { Marker, Popup } from "react-leaflet"
import { Link } from "react-router-dom"
import { ArrowRight, MessageCircle, User } from "lucide-react"
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

const TYPE_LABEL: Record<NodeType, string> = {
  CLI: "Companion (CLI)",
  REP: "Repeater",
  ROOM: "Room server",
  UNKNOWN: "Unknown type",
  SELF: "This device",
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
            <div className="min-w-44 space-y-2">
              <div>
                <div className="text-sm font-semibold leading-tight">{c.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {TYPE_LABEL[c.nodeType]}
                </div>
                <div className="mt-0.5 text-[10px] tabular-nums opacity-60">
                  {c.lat.toFixed(5)}, {c.lon.toFixed(5)}
                </div>
              </div>
              {c.id !== "__self__" ? (
                <div className="flex gap-1.5 border-t pt-2">
                  <Link
                    to={`/contact/${c.id}`}
                    className="flex flex-1 items-center justify-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
                  >
                    <User className="h-3 w-3" />
                    Profile
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                  <Link
                    to={`/chat/${c.id}`}
                    className="flex items-center justify-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent"
                    title={`Message ${c.name}`}
                  >
                    <MessageCircle className="h-3 w-3" />
                  </Link>
                </div>
              ) : (
                <div className="border-t pt-2">
                  <Link
                    to="/device"
                    className="flex items-center justify-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
                  >
                    Device info
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  )
}
