/**
 * Extract our own short attachment URLs from a message body.
 *
 * Only matches URLs whose host + path prefix equal the configured
 * `publicBaseUrl` (foreign hosts are ignored — we never want to render
 * an inline image preview for an unrelated link). The slug grammar is
 * the same 8-char base62 alphabet the backend mints, anchored by word
 * boundaries so trailing punctuation can't extend the match.
 */
export interface ParsedAttachment {
  slug: string
  url: string
  thumbUrl: string
}

const SLUG_LEN = 8

export function parseAttachmentUrls(
  body: string,
  publicBaseUrl: string,
): ParsedAttachment[] {
  if (!publicBaseUrl) return []
  const escaped = publicBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Bound by start-of-string / whitespace on the left and end-of-string /
  // whitespace on the right so e.g. ".../s/aaaaaaaaX" or trailing "," do
  // not produce a false positive against the 8-char slug.
  const re = new RegExp(
    `(?:^|\\s)(${escaped}/s/[0-9A-Za-z]{${SLUG_LEN}})(?=$|\\s)`,
    "g",
  )
  const out: ParsedAttachment[] = []
  for (const m of body.matchAll(re)) {
    const url = m[1]
    const slug = url.slice(-SLUG_LEN)
    out.push({ slug, url, thumbUrl: `${publicBaseUrl}/i/${slug}/thumb` })
  }
  return out
}
