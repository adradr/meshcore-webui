import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { List, X } from "lucide-react"
import { ClusteredContactMap } from "@/components/map/ClusteredContactMap"
import { TracePathLayer } from "@/components/map/TracePathLayer"
import { TraceMonitorMapLayer } from "@/components/map/TraceMonitorMapLayer"
import type { ContactMarker } from "@/components/map/MarkersLayer"
import { useContacts, type Contact } from "@/features/contacts/queries"
import { useSelfInfo } from "@/features/device/queries"
import { useTheme } from "@/components/theme-provider"
import type { NodeType } from "@/components/map/nodeIcons"
import { LineOfSightModal } from "@/features/los/LineOfSightModal"
import { useTracePath, type TraceOut } from "@/features/trace/api"
import {
  useStartTraceMonitor,
  useTraceMonitorStatus,
  useTraceMonitorSamples,
} from "@/features/trace/monitor/api"
import { TraceHopsDrawer } from "@/features/trace/TraceHopsDrawer"
import { Button } from "@/components/ui/button"
import { useAuthInfo } from "@/features/auth/api"
import { tilesAreDefault } from "@/components/map/tileDisclosure"

// 10 s is the default cadence we kick off with from the map. Operators can
// re-tune via the slider on the contact-detail page once the chart is in
// view. Must stay within the backend's settings.trace_monitor_min_interval_s
// (default 5 s) — if you change this, double-check the live setting.
const MAP_MONITOR_DEFAULT_INTERVAL_S = 10

function nodeTypeFor(type: number | undefined): NodeType {
  if (type === 1) return "CLI"
  if (type === 2) return "REP"
  if (type === 3) return "ROOM"
  return "UNKNOWN"
}

/**
 * Resolve effective dark mode: explicit user choice wins, otherwise we
 * consult the live `<html class="dark">` flag that ThemeProvider keeps in sync.
 */
function useIsDark(): boolean {
  const { theme } = useTheme()
  const [systemDark, setSystemDark] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const m = window.matchMedia("(prefers-color-scheme: dark)")
    setSystemDark(m.matches)
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    m.addEventListener("change", handler)
    return () => m.removeEventListener("change", handler)
  }, [])
  if (theme === "dark") return true
  if (theme === "light") return false
  return systemDark
}

export function MapPage() {
  const { data } = useContacts()
  const { data: selfInfo } = useSelfInfo()
  const dark = useIsDark()
  const auth = useAuthInfo()
  const showTileDisclosure = tilesAreDefault(
    auth.data?.tile_url_light,
    auth.data?.tile_url_dark,
  )
  const [losTarget, setLosTarget] = useState<{
    name: string
    lat: number
    lon: number
  } | null>(null)

  const traceMutation = useTracePath()
  const [activeTrace, setActiveTrace] = useState<TraceOut | null>(null)
  const [hopsOpen, setHopsOpen] = useState(false)
  // Track the in-flight node's pubkey rather than a single boolean so each
  // marker popup can decide whether to spin (itself) or merely grey out (other
  // nodes) — see MarkerPopupBody for the per-marker rendering logic.
  const [tracingPubkey, setTracingPubkey] = useState<string | null>(null)

  // Monitor entry point — starts a continuous trace session and routes the
  // user to the contact-detail panel where the chart + stats live. `force:
  // true` because the map is the fast-switching surface; the deliberate
  // non-overriding choice lives on contact-detail.
  const navigate = useNavigate()
  const startMonitor = useStartTraceMonitor()
  // Continuous trace-monitor overlay — green polyline + hop dots painted on
  // the same map as the one-shot trace. We only mount it while a session is
  // actually running so we don't keep dangling samples queries warm forever.
  const monitorStatus = useTraceMonitorStatus()
  const monitorSamples =
    useTraceMonitorSamples(monitorStatus.data?.session_id ?? null).data ?? []
  // No in-flight spinner / state on the map — `useStartTraceMonitor`
  // already toasts on failure via `notifyError`, and the success path
  // navigates immediately, so a button-level spinner would only flash
  // for the few hundred ms before the route change.
  const handleMonitorRequest = (c: ContactMarker) => {
    startMonitor.mutate(
      { pubkey: c.id, interval_s: MAP_MONITOR_DEFAULT_INTERVAL_S, force: true },
      {
        onSuccess: () => navigate(`/contact/${c.id}`),
      },
    )
  }

  // ``self`` and ``contacts`` are memoised on their source data refs so the
  // 5 s ``useTraceMonitorStatus`` poll (which re-renders MapPage on every
  // tick) doesn't keep producing fresh array/object identities. Without the
  // memo, react-leaflet-cluster sees a new ``contacts`` array prop every
  // 5 s, re-runs its clustering pass, and closes any open marker popup —
  // visible to the user as a popup that flickers shut every 5 seconds.
  const self = useMemo(() => {
    if (
      !selfInfo ||
      typeof selfInfo.adv_lat !== "number" ||
      typeof selfInfo.adv_lon !== "number" ||
      (Math.abs(selfInfo.adv_lat) < 0.0001 && Math.abs(selfInfo.adv_lon) < 0.0001)
    ) {
      return null
    }
    return {
      name: (selfInfo.name as string | undefined) ?? "This device",
      lat: selfInfo.adv_lat as number,
      lon: selfInfo.adv_lon as number,
    }
  }, [selfInfo])

  const contacts = useMemo(() => {
    if (!data) return []
    return Object.entries(data)
      .map(([pubKey, c]: [string, Contact]) => ({ pubKey, c }))
      // Many MeshCore nodes broadcast 0,0 as a "no GPS" sentinel — hide those
      // (they'd otherwise pile up in the Atlantic off the West African coast).
      .filter(({ c }) => {
        if (c.adv_lat == null || c.adv_lon == null) return false
        if (Math.abs(c.adv_lat) < 0.0001 && Math.abs(c.adv_lon) < 0.0001) return false
        return true
      })
      .map(({ pubKey, c }) => ({
        id: c.public_key ?? pubKey,
        name: c.adv_name ?? pubKey.slice(0, 8),
        lat: c.adv_lat as number,
        lon: c.adv_lon as number,
        nodeType: nodeTypeFor(c.type),
      }))
  }, [data])

  const handleTraceRequest = (c: { id: string; name: string }) => {
    setTracingPubkey(c.id)
    traceMutation.mutate(c.id, {
      onSuccess: (trace) => {
        setActiveTrace(trace)
      },
      // Clear on settled (NOT onSuccess) so an error doesn't leave the
      // markers wedged in the disabled state forever.
      onSettled: () => setTracingPubkey(null),
    })
  }

  const clearTrace = () => {
    setActiveTrace(null)
    setHopsOpen(false)
  }

  return (
    <div className="relative h-full w-full">
      <ClusteredContactMap
        contacts={contacts}
        self={self}
        dark={dark}
        onLosRequest={
          self
            ? (c) => setLosTarget({ name: c.name, lat: c.lat, lon: c.lon })
            : undefined
        }
        selfHasGps={self !== null}
        onTraceRequest={handleTraceRequest}
        traceInFlightPubkey={tracingPubkey}
        onMonitorRequest={handleMonitorRequest}
      >
        {activeTrace && (
          <TracePathLayer hops={activeTrace.hops} origin={self} />
        )}
        {monitorStatus.data?.running && data && (
          <TraceMonitorMapLayer
            samples={monitorSamples}
            contacts={data}
            self={self}
          />
        )}
      </ClusteredContactMap>
      <LineOfSightModal
        open={losTarget !== null}
        onOpenChange={(open) => {
          if (!open) setLosTarget(null)
        }}
        a={self}
        b={losTarget}
      />
      {activeTrace && (
        <div className="absolute right-4 top-4 z-[1000] flex flex-col gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setHopsOpen(true)}
          >
            <List className="mr-1 h-4 w-4" />
            {activeTrace.hops.length} hops
          </Button>
          <Button size="sm" variant="ghost" onClick={clearTrace}>
            <X className="mr-1 h-4 w-4" />
            Clear trace
          </Button>
        </div>
      )}
      <TraceHopsDrawer
        open={hopsOpen}
        onOpenChange={setHopsOpen}
        trace={activeTrace}
      />
      {showTileDisclosure && (
        // Positioned above Leaflet's stock bottom-right attribution so it
        // doesn't collide with it. z-[500] sits above the tile pane but
        // below the trace control buttons and any open marker popup
        // (which Leaflet pins at z-700+).
        <div
          data-testid="tile-privacy-note"
          className="absolute bottom-8 left-2 z-[500] max-w-xs rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow"
        >
          Map tiles delivered by{" "}
          <a
            href="https://www.openstreetmap.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            OpenStreetMap
          </a>
          {" / "}
          <a
            href="https://carto.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            CARTO
          </a>
          {" — your IP and viewport are visible to them. Self-host tiles to avoid this."}
        </div>
      )}
    </div>
  )
}
