/**
 * FNV-1a 32-bit hash over the given string.
 *
 * Shared deterministic hash used by `colorForPubkey` and identicon generation
 * so the same seed always yields the same color + pattern pair.
 *
 * Hashes the full string (not just a prefix). The original `colorForPubkey`
 * implementation only consumed the first 16 hex chars; keep that behavior
 * inside `colorForPubkey` and use the full-string variant for identicons.
 */
export function _fnv1a32(input: string, maxChars?: number): number {
  let h = 2166136261
  const end = maxChars == null ? input.length : Math.min(maxChars, input.length)
  for (let i = 0; i < end; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h
}

/**
 * Deterministic HSL color from a pubkey hex string.
 *
 * Uses a small FNV-1a-style hash over the first 16 hex chars so the same
 * pubkey always yields the same color, and visually-similar pubkeys map
 * to different hues.
 */
export function colorForPubkey(pubkey: string): string {
  const h = _fnv1a32(pubkey, 16)
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
