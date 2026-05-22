import { Link } from "react-router-dom"
import { ArrowRight, Loader2, MessageCircle, Radio, Route, User } from "lucide-react"
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
  /** Emitted when the user clicks the "Trace path" button (REP/ROOM only). */
  onTraceRequest?: (c: ContactMarker) => void
  /**
   * Pubkey of the node whose trace is currently in flight, or `null` when no
   * trace is running. The popup whose `contact.id` matches shows the spinner;
   * every OTHER node's Trace button is disabled (greyed) but does not spin —
   * so the user isn't misled into thinking they're waiting on unrelated nodes.
   */
  traceInFlightPubkey?: string | null
}

/** Node types where the "Trace path" button makes sense (multi-hop targets). */
const TRACEABLE_TYPES: ReadonlySet<NodeType> = new Set(["REP", "ROOM"])

/**
 * Node types that accept a plain DM. Repeaters and room servers receive
 * admin commands over a different protocol path (see upstream
 * `meshcore-cli` lines 1149-1208), and this WebUI doesn't yet implement
 * that flow — so we hide the Message link rather than route the user to
 * a chat that would silently fail. UNKNOWN keeps the button as a safe
 * fallback: better a usable-looking chat than a wrongly-hidden one.
 */
const MESSAGEABLE_NODE_TYPES: ReadonlySet<NodeType> = new Set([
  "CLI",
  "UNKNOWN",
])

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
  onTraceRequest,
  traceInFlightPubkey = null,
}: Props) {
  const losDisabled = !selfHasGps || !onLosRequest
  const losTitle = selfHasGps
    ? `Line of sight to ${contact.name}`
    : "Self location unknown — set up your device's GPS to compute line of sight"
  const showTrace = TRACEABLE_TYPES.has(contact.nodeType) && !!onTraceRequest
  const showMessage = MESSAGEABLE_NODE_TYPES.has(contact.nodeType)
  const isThisTracing = traceInFlightPubkey === contact.id
  const anyTracing = traceInFlightPubkey != null
  const traceDisabled = anyTracing

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
          {showMessage && (
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
          )}
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
          {showTrace && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 w-9 p-0"
              title="Trace path"
              aria-label={`Trace path to ${contact.name}`}
              disabled={traceDisabled}
              onClick={() => onTraceRequest?.(contact)}
            >
              {isThisTracing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Route className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
