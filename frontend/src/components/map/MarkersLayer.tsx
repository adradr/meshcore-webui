import { Marker, Popup } from "react-leaflet"
import { Link } from "react-router-dom"
import { ArrowRight, MessageCircle, User } from "lucide-react"
import { iconForNodeType, type NodeType } from "./nodeIcons"
import { Button } from "@/components/ui/button"

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
                <div className="mc-popup-actions flex gap-1.5 border-t pt-2">
                  <Button asChild size="sm" className="flex-1 h-8">
                    <Link to={`/contact/${c.id}`}>
                      <User className="mr-1 h-3.5 w-3.5" />
                      Profile
                      <ArrowRight className="ml-auto h-3 w-3 opacity-70" />
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="h-8 w-9 p-0" title={`Message ${c.name}`}>
                    <Link to={`/chat/${c.id}`} aria-label={`Message ${c.name}`}>
                      <MessageCircle className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="mc-popup-actions border-t pt-2">
                  <Button asChild size="sm" className="w-full h-8">
                    <Link to="/device">
                      Device info
                      <ArrowRight className="ml-1 h-3 w-3 opacity-70" />
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  )
}
