import { Link } from "react-router-dom"
import type { MentionContact } from "./MentionInput"

/**
 * Parse a message body and wrap each `@<adv_name>` that matches a known
 * contact in a router Link to the corresponding DM. Unrecognized `@xxx`
 * tokens stay as plain text.
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

  const flushBuffer = () => {
    if (buffer.length > 0) {
      nodes.push(buffer)
      buffer = ""
    }
  }

  while (i < text.length) {
    const atWordBoundary = i === 0 || /\s/.test(text[i - 1])
    if (text[i] === "@" && atWordBoundary) {
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
