// Shared validators for the Add-Channel flows. Kept tiny + framework-free so
// they're trivially unit-testable and reusable across the five sub-forms +
// the QR-scan path.

/** 16-byte channel secret encoded as exactly 32 hex characters. */
export const PSK_HEX_RE = /^[0-9a-fA-F]{32}$/

/**
 * Hashtag channel name: leading `#` followed by ≥1 ASCII letter/digit/underscore.
 * The MeshCore lib derives the PSK from sha256(name)[:16] when no PSK is
 * supplied, so the literal `#` is part of what gets hashed and must be present.
 */
export const HASHTAG_RE = /^#[A-Za-z0-9_]+$/

export interface QrChannelPayload {
  name: string
  secret: string
}

/**
 * Parse a `meshcore://channel/add?name=…&secret=…` URI as documented in
 * `docs/external/meshcore/qr_codes.md`. Returns `null` on any mismatch —
 * callers surface a friendly toast rather than throwing.
 */
export function parseChannelQrPayload(raw: string): QrChannelPayload | null {
  if (typeof raw !== "string" || raw.length === 0) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "meshcore:") return null
  // URL parses meshcore://channel/add as host=channel, pathname=/add.
  if (url.host !== "channel" || url.pathname !== "/add") return null
  const name = url.searchParams.get("name") ?? ""
  const secret = url.searchParams.get("secret") ?? ""
  if (!name || !PSK_HEX_RE.test(secret)) return null
  return { name, secret: secret.toLowerCase() }
}
