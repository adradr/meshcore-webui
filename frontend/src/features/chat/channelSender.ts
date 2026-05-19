import type { Contact } from "@/features/contacts/queries"

export interface ChannelSender {
  /** The parsed name as it appeared in the message. */
  name: string
  /** Full public key, if we could match this name to a contact. */
  publicKey?: string
  /** The message body with the "Name: " prefix stripped. */
  body: string
}

/**
 * MeshCore channel messages don't carry a sender field on the wire — the
 * convention is that the sender prefixes their own adv_name into the
 * message text as "Name: body" (with a colon and space).
 *
 * This parser extracts the leading name + the remaining body, and tries to
 * resolve the name against the local contacts map.
 *
 * Returns null when no "Name: " prefix is found (e.g. messages from our own
 * device that the firmware doesn't prefix, or unusual content).
 *
 * Caveat: a leading URL like "https://example.com/foo: hi" will be parsed
 * as a sender named "https" — URLs at the start of channel messages are
 * vanishingly rare in practice, so we don't try to detect them here.
 */
export function parseChannelSender(
  text: string,
  contacts: Record<string, Contact> | undefined,
): ChannelSender | null {
  // Match a leading "<name>: " where name is 1-48 chars, no newline, no colon
  // (so we don't false-match "12:34" timestamps inside a sentence). Body may
  // span multiple lines.
  const m = text.match(/^([^:\n\r]{1,48}):[ \t]+([\s\S]*)$/)
  if (!m) return null
  const candidateName = m[1].trim()
  if (!candidateName) return null
  // Reject candidates that look like bare hour numbers (e.g. "14" from "14:30")
  if (/^\d{1,2}$/.test(candidateName)) return null
  const body = m[2]

  if (!contacts) {
    return { name: candidateName, body }
  }
  // Normalize for comparison: NFC + strip emoji variation selectors (U+FE0F)
  // + collapse whitespace + case-fold. This handles common drift between
  // what a sender prefixed into their message body and what's stored in our
  // contact list (e.g. "🚶‍➡️" vs "🚶‍➡", or "HU_BU3" vs "HU-BU3").
  const normalized = normalizeName(candidateName)
  for (const c of Object.values(contacts)) {
    if (!c.adv_name || !c.public_key) continue
    if (normalizeName(c.adv_name) === normalized) {
      return { name: candidateName, publicKey: c.public_key, body }
    }
  }
  return { name: candidateName, body }
}

/** NFC-normalize, strip variation selectors, casefold, collapse whitespace. */
function normalizeName(s: string): string {
  return s
    .normalize("NFC")
    .replace(/️/g, "") // emoji variation selector
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}
