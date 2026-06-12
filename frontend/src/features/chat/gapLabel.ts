/** Human label for an in-conversation time gap (used by GapSeparator). */
export function gapLabel(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 120) return `${m} minutes later`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hours later`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? "" : "s"} later`
}
