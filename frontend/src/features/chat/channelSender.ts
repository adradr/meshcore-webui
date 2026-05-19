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
  // Try exact match first
  for (const c of Object.values(contacts)) {
    if (c.adv_name === candidateName && c.public_key) {
      return { name: candidateName, publicKey: c.public_key, body }
    }
  }
  // Case-insensitive fallback (some users send slightly different casing)
  const lower = candidateName.toLowerCase()
  for (const c of Object.values(contacts)) {
    if (c.adv_name?.toLowerCase() === lower && c.public_key) {
      return { name: candidateName, publicKey: c.public_key, body }
    }
  }
  return { name: candidateName, body }
}
