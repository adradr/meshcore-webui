import type { RxEntry } from "@/features/rx_log/api"

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
  if (unixSeconds == null || unixSeconds === 0) return "—"
  const diffSec = Math.round(nowMs / 1000 - unixSeconds)
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
