import type { Contact } from "@/features/contacts/queries"

/** MeshCore contact node type: 2 = repeater (REP). */
const CONTACT_TYPE_REPEATER = 2

export interface RepeaterHop {
  /** Display name — either matched contact adv_name or "Repeater <HASH>". */
  name: string
  /** Two-char uppercase hex hash prefix. */
  hash: string
  /** True if a matching repeater contact was found in the local contacts list. */
  resolved: boolean
  /**
   * Full hex public key of the matched repeater contact, if `resolved`.
   * The HeardRepeatsSheet uses this to navigate to `/contact/{pubkey}` on
   * click — without it the only identifier on a hop is the 2-char hash
   * which isn't unique enough to address a contact route.
   */
  pubkey?: string
}

/**
 * Decode a MeshCore contact.path hex string into a list of repeater hops.
 * Each pair of hex chars represents one repeater's hash-prefix byte.
 * Returns [] if pathHex is empty/missing (i.e. direct, no repeaters).
 */
export function parseRepeaterPath(
  pathHex: string | null | undefined,
  contacts: Record<string, Contact>,
): RepeaterHop[] {
  if (!pathHex) return []
  const clean = pathHex.replace(/[^0-9a-fA-F]/g, "")
  const hashes = clean.match(/.{2}/g) ?? []
  return hashes.map((h: string) => {
    const lower = h.toLowerCase()
    const match = Object.values(contacts).find(
      (c) =>
        c.type === CONTACT_TYPE_REPEATER &&
        c.public_key?.toLowerCase().startsWith(lower),
    )
    return {
      name: match?.adv_name ?? `Repeater ${h.toUpperCase()}`,
      hash: h.toUpperCase(),
      resolved: Boolean(match),
      pubkey: match?.public_key,
    }
  })
}
