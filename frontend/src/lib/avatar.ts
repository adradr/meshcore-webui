/**
 * Deterministic HSL color from a pubkey hex string.
 *
 * Uses a small FNV-1a-style hash over the first 16 hex chars so the same
 * pubkey always yields the same color, and visually-similar pubkeys map
 * to different hues.
 */
export function colorForPubkey(pubkey: string): string {
  let h = 2166136261
  for (let i = 0; i < Math.min(16, pubkey.length); i++) {
    h ^= pubkey.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 60%, 50%)`
}

/**
 * Returns up to two uppercase initials for the given display name.
 * Splits on whitespace, underscores, and dashes. Returns "?" for empty
 * names so callers always render something readable.
 */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/[\s_-]+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
