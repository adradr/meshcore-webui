import { useMemo } from "react"
import { Polyline, CircleMarker, Tooltip } from "react-leaflet"
import type { TraceSample } from "@/features/trace/monitor/api"
import type { Contact } from "@/features/contacts/queries"

interface Props {
  samples: TraceSample[]
  contacts: Record<string, Contact>
  self: { lat: number; lon: number } | null
}

// Map first 2 hex chars of a pubkey to the full contact, the same way
// parseRepeaterPath does in features/chat/repeaterPath.ts. Centralise here
// to avoid pulling that whole module in for a 4-line lookup.
function buildHashIndex(
  contacts: Record<string, Contact>,
): Map<string, Contact> {
  const idx = new Map<string, Contact>()
  for (const c of Object.values(contacts)) {
    // Only repeaters (type 2) forward trace packets and carry hop hashes.
    // Matches parseRepeaterPath's filter.
    if (c.type !== 2) continue
    const pk = c.public_key
    if (typeof pk === "string" && pk.length >= 2) {
      const h = pk.slice(0, 2).toLowerCase()
      if (!idx.has(h)) idx.set(h, c)
    }
  }
  return idx
}

export function TraceMonitorMapLayer({ samples, contacts, self }: Props) {
  const hashIndex = useMemo(() => buildHashIndex(contacts), [contacts])

  // Latest ok sample → polyline.
  const latest = useMemo(() => {
    for (let i = samples.length - 1; i >= 0; i--) {
      if (samples[i].status === "ok") return samples[i]
    }
    return null
  }, [samples])

  // Distinct hop hashes across the buffer → markers.
  const distinctHops = useMemo(() => {
    const map = new Map<string, { c: Contact; okCount: number }>()
    for (const s of samples) {
      if (s.status !== "ok") continue
      for (const h of s.hops) {
        const lh = h.hash.toLowerCase()
        const c = hashIndex.get(lh)
        if (!c || c.adv_lat == null || c.adv_lon == null) continue
        const slot = map.get(lh) ?? { c, okCount: 0 }
        slot.okCount += 1
        map.set(lh, slot)
      }
    }
    return Array.from(map.entries())
  }, [samples, hashIndex])

  if (!latest) return null

  const points: [number, number][] = []
  if (self) points.push([self.lat, self.lon])
  for (const h of latest.hops) {
    const c = hashIndex.get(h.hash.toLowerCase())
    if (c?.adv_lat != null && c.adv_lon != null) {
      points.push([c.adv_lat, c.adv_lon])
    }
  }
  if (points.length < 2) return null

  return (
    <>
      <Polyline
        positions={points}
        pathOptions={{ color: "rgb(34, 197, 94)", weight: 3, opacity: 0.85 }}
      />
      {distinctHops.map(([hash, slot]) => (
        <CircleMarker
          key={hash}
          center={[slot.c.adv_lat!, slot.c.adv_lon!]}
          radius={6}
          pathOptions={{
            color: "rgb(34, 197, 94)",
            fillColor: "rgb(34, 197, 94)",
            fillOpacity: 0.6,
          }}
        >
          <Tooltip>
            {slot.c.adv_name ?? hash} · {slot.okCount} ok samples
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  )
}
