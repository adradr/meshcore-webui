import type { RxEntry } from "@/features/rx_log/api"
import { isPlausibleSeconds } from "@/lib/timestamps"

export function formatRecvClock(unixSeconds: number | null | undefined): string {
  if (unixSeconds == null || unixSeconds === 0) return "—"
  const d = new Date(unixSeconds * 1000)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

export function relativeTime(
  unixSeconds: number | null | undefined,
  nowMs: number = Date.now(),
): string {
  // Short-circuit implausible timestamps to an em-dash so the UI doesn't
  // render nonsense like "55483 days ago" for a -1 sentinel or
  // "-30s ago" for a future-dated value. ``isPlausibleSeconds`` already
  // covers the legacy ``null | undefined | 0`` cases.
  if (!isPlausibleSeconds(unixSeconds, nowMs)) return "—"
  const diffSec = Math.round(nowMs / 1000 - (unixSeconds as number))
  if (diffSec < 1) return "now"
  if (diffSec < 60) return `${diffSec}s ago`
  const minutes = Math.floor(diffSec / 60)
  const seconds = diffSec % 60
  if (diffSec < 3600) {
    return seconds > 0 ? `${minutes}m ${seconds}s ago` : `${minutes}m ago`
  }
  const hours = Math.floor(diffSec / 3600)
  const remMinutes = Math.floor((diffSec % 3600) / 60)
  if (diffSec < 86400) {
    return remMinutes > 0 ? `${hours}h ${remMinutes}m ago` : `${hours}h ago`
  }
  const days = Math.floor(diffSec / 86400)
  return `${days}d ago`
}

/**
 * Display helper for "last heard" / "last advert" labels: returns a
 * relative-time string for plausible timestamps, ``null`` for
 * missing or implausible values so call-sites can hide the row by
 * truthiness check rather than rendering a misleading em-dash.
 *
 * Use this in contact lists / profile cards where the surrounding chrome
 * (badge, label) only makes sense if there's a real timestamp to show.
 * ``relativeTime`` itself is preserved for table cells (rx log) that
 * need a visible em-dash placeholder.
 */
export function formatLastSeen(
  unixSeconds: number | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!isPlausibleSeconds(unixSeconds, nowMs)) return null
  return relativeTime(unixSeconds, nowMs)
}

export function formatRssi(rssi: number | null | undefined): string {
  if (rssi == null) return "—"
  return `${rssi} dBm`
}

export function formatSnr(snr: number | null | undefined): string {
  if (snr == null) return "—"
  return `${snr.toFixed(1)} dB`
}

export function truncateHash(hash: string | null | undefined): string {
  if (!hash) return "—"
  return hash.length > 8 ? hash.slice(0, 8) : hash
}

export function rowMatches(entry: RxEntry, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    (entry.pkt_hash?.toLowerCase().includes(needle) ?? false) ||
    (entry.raw_hex?.toLowerCase().includes(needle) ?? false) ||
    (entry.payload?.toLowerCase().includes(needle) ?? false)
  )
}

export function chunkHex(hex: string | null | undefined): string {
  if (!hex) return ""
  const cleaned = hex.replace(/\s+/g, "")
  const bytes = cleaned.match(/.{1,2}/g) ?? []
  const lines: string[] = []
  for (let i = 0; i < bytes.length; i += 16) {
    const offset = i.toString(16).padStart(4, "0")
    const chunk = bytes.slice(i, i + 16).join(" ")
    lines.push(`${offset}  ${chunk}`)
  }
  return lines.join("\n")
}

export type TypenameField = "route_typename" | "payload_typename"

export interface TypenameOption {
  value: string
  label: string
  count: number
}

export function deriveOptions(
  entries: RxEntry[],
  field: TypenameField,
): TypenameOption[] {
  const counts = new Map<string, number>()
  for (const e of entries) {
    const v = e[field]
    if (typeof v === "string" && v.length > 0) {
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({
      value,
      label: `${value} (${count})`,
      count,
    }))
    .sort((a, b) => a.value.localeCompare(b.value))
}
