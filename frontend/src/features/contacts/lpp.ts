/**
 * Cayenne LPP helpers for the telemetry response payload returned by
 * `/api/contacts/{pk}/telemetry`: `{ pubkey_pre, lpp: [{channel, type, value}] }`
 * where `type` is the LPP type NAME serialized by the meshcore lib's
 * `lpp_json_encoder` and `value` is a number or a named-field object
 * (e.g. gps -> { latitude, longitude, altitude }).
 */

const LPP_UNITS: Record<string, string> = {
  voltage: " V",
  current: " A",
  temperature: " °C",
  humidity: " %",
  percentage: " %",
  barometer: " hPa",
  altitude: " m",
  distance: " m",
  frequency: " Hz",
  power: " W",
  energy: " Wh",
  illuminance: " lx",
}

export interface LppEntry {
  channel: number
  type: string
  value: unknown
}

/** Extracts the LPP entry list from a telemetry response, or null. */
export function lppEntries(data: unknown): LppEntry[] | null {
  if (typeof data !== "object" || data === null) return null
  const lpp = (data as { lpp?: unknown }).lpp
  if (!Array.isArray(lpp) || lpp.length === 0) return null
  const entries: LppEntry[] = []
  for (const e of lpp) {
    if (typeof e !== "object" || e === null) return null
    const { channel, type, value } = e as Record<string, unknown>
    if (typeof channel !== "number") return null
    entries.push({ channel, type: String(type), value })
  }
  return entries
}

/** Formats an LPP value (number or named-field object) with its unit. */
export function formatLppValue(type: string, value: unknown): string {
  const unit = LPP_UNITS[type] ?? ""
  if (typeof value === "number") return `${value}${unit}`
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(", ")
  }
  return String(value)
}
