import { useEffect, useState } from "react"
import { ClusteredContactMap } from "@/components/map/ClusteredContactMap"
import { useContacts, type Contact } from "@/features/contacts/queries"
import { useTheme } from "@/components/theme-provider"
import type { NodeType } from "@/components/map/nodeIcons"

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
  const dark = useIsDark()

  const contacts = data
    ? Object.entries(data)
        .map(([pubKey, c]: [string, Contact]) => ({ pubKey, c }))
        .filter(({ c }) => c.adv_lat != null && c.adv_lon != null)
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
      <ClusteredContactMap contacts={contacts} dark={dark} />
    </div>
  )
}
