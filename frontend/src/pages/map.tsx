import { useEffect, useState } from "react"
import { ClusteredContactMap } from "@/components/map/ClusteredContactMap"
import { useContacts, type Contact } from "@/features/contacts/queries"
import { useSelfInfo } from "@/features/device/queries"
import { useTheme } from "@/components/theme-provider"
import type { NodeType } from "@/components/map/nodeIcons"
import { LineOfSightModal } from "@/features/los/LineOfSightModal"

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

  return (
    <div className="h-full w-full">
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
      />
      <LineOfSightModal
        open={losTarget !== null}
        onOpenChange={(open) => {
          if (!open) setLosTarget(null)
        }}
        a={self}
        b={losTarget}
      />
    </div>
  )
}
