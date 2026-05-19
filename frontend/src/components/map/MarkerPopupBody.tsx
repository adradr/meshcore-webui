import { Link } from "react-router-dom"
import { ArrowRight, MessageCircle, Radio, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ContactMarker } from "./MarkersLayer"
import type { NodeType } from "./nodeIcons"

const TYPE_LABEL: Record<NodeType, string> = {
  CLI: "Companion (CLI)",
  REP: "Repeater",
  ROOM: "Room server",
  UNKNOWN: "Unknown type",
  SELF: "This device",
}

interface Props {
  contact: ContactMarker
  /** Emitted when the user clicks the "Line of sight" button. */
  onLosRequest?: (c: ContactMarker) => void
  /** When false (self GPS unknown), LoS button is disabled with a helpful tooltip. */
  selfHasGps?: boolean
  /** True when this popup belongs to the user's own device pin (sentinel id `__self__`). */
  isSelf: boolean
}

/**
 * Popup body for a marker on the contact map. Extracted from `MarkersLayer`
 * so it can be unit-tested in isolation — Leaflet's popup rendering is
 * notoriously hard to drive through JSDOM because popups mount lazily into
 * a detached DOM node outside the React tree.
 */
export function MarkerPopupBody({
  contact,
  onLosRequest,
  selfHasGps,
  isSelf,
}: Props) {
  const losDisabled = !selfHasGps || !onLosRequest
  const losTitle = selfHasGps
    ? `Line of sight to ${contact.name}`
    : "Self location unknown — set up your device's GPS to compute line of sight"

  return (
    <div className="min-w-44 space-y-2">
      <div>
        <div className="text-sm font-semibold leading-tight">{contact.name}</div>
        <div className="text-[11px] text-muted-foreground">
          {TYPE_LABEL[contact.nodeType]}
        </div>
        <div className="mt-0.5 text-[10px] tabular-nums opacity-60">
          {contact.lat.toFixed(5)}, {contact.lon.toFixed(5)}
        </div>
      </div>
      {isSelf ? (
        <div className="mc-popup-actions border-t pt-2">
          <Button asChild size="sm" className="w-full h-8">
            <Link to="/device">
              Device info
              <ArrowRight className="ml-1 h-3 w-3 opacity-70" />
            </Link>
          </Button>
        </div>
      ) : (
        <div className="mc-popup-actions flex gap-1.5 border-t pt-2">
          <Button asChild size="sm" className="flex-1 h-8">
            <Link to={`/contact/${contact.id}`}>
              <User className="mr-1 h-3.5 w-3.5" />
              Profile
              <ArrowRight className="ml-auto h-3 w-3 opacity-70" />
            </Link>
          </Button>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-8 w-9 p-0"
            title={`Message ${contact.name}`}
          >
            <Link to={`/chat/${contact.id}`} aria-label={`Message ${contact.name}`}>
              <MessageCircle className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-9 p-0"
            title={losTitle}
            aria-label={`Compute line of sight to ${contact.name}`}
            disabled={losDisabled}
            onClick={() => onLosRequest?.(contact)}
          >
            <Radio className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}
