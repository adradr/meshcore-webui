import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { ClusteredContactMap } from "@/components/map/ClusteredContactMap"
import { TracePathLayer } from "@/components/map/TracePathLayer"
import { useContacts, type Contact } from "@/features/contacts/queries"
import { useSelfInfo } from "@/features/device/queries"
import { useTheme } from "@/components/theme-provider"
import type { NodeType } from "@/components/map/nodeIcons"
import { LineOfSightModal } from "@/features/los/LineOfSightModal"
import {
  useTracePath,
  type TraceHopOut,
  type TraceOut,
} from "@/features/trace/api"
import { Button } from "@/components/ui/button"

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
  const [losTarget, setLosTarget] = useState<{
    name: string
    lat: number
    lon: number
  } | null>(null)

  const traceMutation = useTracePath()
  const [activeTrace, setActiveTrace] = useState<TraceOut | null>(null)
  const [unplottedHops, setUnplottedHops] = useState<TraceHopOut[]>([])

  const self =
    selfInfo &&
    typeof selfInfo.adv_lat === "number" &&
    typeof selfInfo.adv_lon === "number" &&
    !(Math.abs(selfInfo.adv_lat) < 0.0001 && Math.abs(selfInfo.adv_lon) < 0.0001)
      ? {
          name: (selfInfo.name as string | undefined) ?? "This device",
          lat: selfInfo.adv_lat as number,
          lon: selfInfo.adv_lon as number,
        }
      : null

  const contacts = data
    ? Object.entries(data)
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
    : []

  const handleTraceRequest = (c: { id: string; name: string }) => {
    traceMutation.mutate(c.id, {
      onSuccess: (trace) => {
        setActiveTrace(trace)
        // Clear stale unplotted hops; TracePathLayer will repopulate on mount.
        setUnplottedHops([])
      },
    })
  }

  const clearTrace = () => {
    setActiveTrace(null)
    setUnplottedHops([])
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
        traceInFlight={traceMutation.isPending}
      >
        {activeTrace && (
          <TracePathLayer
            hops={activeTrace.hops}
            origin={self}
            onUnplottedHops={setUnplottedHops}
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
          <Button size="sm" variant="secondary" onClick={clearTrace}>
            <X className="mr-1 h-4 w-4" />
            Clear trace
          </Button>
          {unplottedHops.length > 0 && (
            <div className="bg-popover text-popover-foreground max-w-xs rounded-md border p-3 text-xs shadow-lg">
              <div className="mb-1 font-semibold">
                {unplottedHops.length} hop(s) without GPS
              </div>
              <ul className="space-y-0.5">
                {unplottedHops.map((h, i) => (
                  <li key={`${h.hash}-${i}`} className="font-mono">
                    {h.name ?? `(${h.hash})`} — SNR {h.snr.toFixed(1)} dB
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
