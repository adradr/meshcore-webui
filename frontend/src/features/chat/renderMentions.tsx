import { Link } from "react-router-dom"
import type { MentionContact } from "./MentionInput"

const URL_RE = /\b(https?:\/\/[^\s<>]+[^\s.,;:!?<>()\]'"])/g
const HEX_RE = /\b([0-9a-fA-F]{8,})\b/g

/**
 * Decorate a plain-text fragment with anchor / code spans for autolinked
 * URLs and long hex sequences (likely pubkey snippets). URLs take priority
 * over hex — we link URLs first, then run the hex pass on the remaining
 * non-link segments so we never double-wrap.
 *
 * The `keyPrefix` keeps React keys stable + unique across sibling text
 * fragments emitted from the outer mention walker.
 */
function decorateText(text: string, keyPrefix: string): React.ReactNode[] {
  if (!text) return []
  const out: React.ReactNode[] = []
  let cursor = 0
  let idx = 0
  URL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > cursor) {
      const plain = text.slice(cursor, match.index)
      out.push(...decorateHex(plain, `${keyPrefix}-t${idx++}`))
    }
    const href = match[1]
    out.push(
      <a
        key={`${keyPrefix}-u${idx++}`}
        href={href}
        target="_blank"
        rel="noopener"
        // `[overflow-wrap:anywhere]` lets long un-breakable URLs wrap
        // mid-string so the bubble never overflows a narrow viewport.
        // Plain `break-words` doesn't apply inside <a> reliably.
        className="text-primary underline decoration-1 underline-offset-2 hover:opacity-80 [overflow-wrap:anywhere]"
        onClick={(e) => e.stopPropagation()}
      >
        {href}
      </a>,
    )
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) {
    out.push(...decorateHex(text.slice(cursor), `${keyPrefix}-t${idx++}`))
  }
  return out
}

function decorateHex(text: string, keyPrefix: string): React.ReactNode[] {
  if (!text) return []
  const out: React.ReactNode[] = []
  let cursor = 0
  let idx = 0
  HEX_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = HEX_RE.exec(text)) !== null) {
    // Skip if immediately preceded by 0x or # (already a literal marker).
    const startsAt = match.index
    const prev2 = text.slice(Math.max(0, startsAt - 2), startsAt)
    if (prev2 === "0x" || prev2.endsWith("#")) {
      if (startsAt > cursor) out.push(text.slice(cursor, startsAt + match[0].length))
      else out.push(match[0])
      cursor = startsAt + match[0].length
      continue
    }
    if (startsAt > cursor) out.push(text.slice(cursor, startsAt))
    out.push(
      <code
        key={`${keyPrefix}-h${idx++}`}
        // Long hex pubkey prefixes break mid-string when they'd
        // otherwise overflow a narrow message bubble.
        className="rounded bg-foreground/5 px-1 py-0.5 font-mono text-[0.85em] [overflow-wrap:anywhere]"
      >
        {match[0]}
      </code>,
    )
    cursor = startsAt + match[0].length
  }
  if (cursor < text.length) out.push(text.slice(cursor))
  return out
}

/**
 * Parse a message body and wrap each `@<adv_name>` that matches a known
 * contact in a router Link to the corresponding DM. Plain-text segments are
 * further enriched with URL autolinks and code-style hex chunks. Unrecognized
 * `@xxx` tokens stay as plain text (then themselves URL/hex-decorated).
 *
 * Sorting contacts by descending name length avoids prefix collisions where
 * e.g. "@Bob" would shadow "@Bobby".
 */
export function renderMentions(
  text: string,
  contacts: MentionContact[],
): React.ReactNode[] {
  if (!text) return []
  const sorted = [...contacts].sort(
    (a, b) => b.adv_name.length - a.adv_name.length,
  )

  const nodes: React.ReactNode[] = []
  let i = 0
  let buffer = ""
  let segmentIdx = 0

  const flushBuffer = () => {
    if (buffer.length > 0) {
      nodes.push(...decorateText(buffer, `s${segmentIdx++}`))
      buffer = ""
    }
  }

  const byNameLower = new Map<string, MentionContact>()
  for (const c of contacts) byNameLower.set(c.adv_name.toLowerCase(), c)

  while (i < text.length) {
    const atWordBoundary = i === 0 || /\s/.test(text[i - 1])
    if (text[i] === "@" && atWordBoundary) {
      // MeshCore bracketed mention: @[Name with spaces 📢]
      if (text[i + 1] === "[") {
        const closeIdx = text.indexOf("]", i + 2)
        // Bound the inner name to a sane length and forbid newlines.
        if (closeIdx !== -1 && closeIdx - i - 2 <= 64) {
          const inner = text.slice(i + 2, closeIdx)
          if (inner.length > 0 && !/[\n\r]/.test(inner)) {
            const matched = byNameLower.get(inner.toLowerCase())
            if (matched) {
              flushBuffer()
              nodes.push(
                <Link
                  key={`m-${i}`}
                  to={`/chat/${matched.public_key}`}
                  className="text-primary font-medium hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  @{matched.adv_name}
                </Link>,
              )
              i = closeIdx + 1
              continue
            }
            // Unknown bracketed name → render as plain "@[name]" text
            buffer += text.slice(i, closeIdx + 1)
            i = closeIdx + 1
            continue
          }
        }
      }
      // Bare @Name (sorted longest-first to avoid prefix collisions)
      let matched: MentionContact | null = null
      for (const c of sorted) {
        const slice = text.slice(i + 1, i + 1 + c.adv_name.length)
        if (slice === c.adv_name) {
          matched = c
          break
        }
      }
      if (matched) {
        flushBuffer()
        nodes.push(
          <Link
            key={`m-${i}`}
            to={`/chat/${matched.public_key}`}
            className="text-primary font-medium hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            @{matched.adv_name}
          </Link>,
        )
        i += matched.adv_name.length + 1
        continue
      }
    }
    buffer += text[i]
    i++
  }
  flushBuffer()
  return nodes
}
