import { _fnv1a32 } from "./avatar"

/**
 * Generate a GitHub-style 5×5 block identicon as a standalone SVG string.
 *
 * - Deterministic: same seed → same SVG, always.
 * - Symmetric: left two columns are mirrored to the right; middle column
 *   stands alone, producing a tidy "intentional" look.
 * - Pure shapes: rendered only as `<rect>` elements (no `<text>`), so emoji
 *   or other glyphs in the seed cannot cause broken-glyph rectangles.
 *
 * The 15 bits used to fill the left 3 columns × 5 rows come from the
 * FNV-1a hash of the seed; the foreground hue is derived from the same hash
 * so the color stays in sync with `colorForPubkey`-style accents.
 */
export function identiconSvg(seed: string, size = 100): string {
  const h = _fnv1a32(seed)
  const hue = Math.abs(h) % 360
  const fg = `hsl(${hue}, 60%, 45%)`
  const cellSize = size / 5
  const cells: string[] = []

  // Iterate the 15 cells of the left 3 columns × 5 rows. Each bit of the
  // hash decides whether to fill that cell. Right two columns are filled by
  // mirroring columns 0 and 1 across the vertical centerline (column 2).
  for (let i = 0; i < 15; i++) {
    if (((h >>> i) & 1) === 1) {
      const col = Math.floor(i / 5)
      const row = i % 5
      cells.push(
        `<rect x="${col * cellSize}" y="${row * cellSize}" width="${cellSize}" height="${cellSize}" />`,
      )
      if (col < 2) {
        const mirrorCol = 4 - col
        cells.push(
          `<rect x="${mirrorCol * cellSize}" y="${row * cellSize}" width="${cellSize}" height="${cellSize}" />`,
        )
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"` +
    ` width="${size}" height="${size}" shape-rendering="crispEdges">` +
    `<g fill="${fg}">${cells.join("")}</g></svg>`
  )
}

/**
 * Soft pastel HSL color derived from the same seed as the identicon's
 * foreground. Use this on the avatar wrapper so empty cells read as a
 * harmonious tinted background rather than transparent page bg.
 */
export function identiconBgColor(seed: string): string {
  const h = _fnv1a32(seed)
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 35%, 92%)`
}

/**
 * Convenience helper: returns a `data:image/svg+xml;utf8,...` URL ready to
 * drop into an `<img src>` or `<AvatarImage src>` attribute.
 */
export function identiconDataUrl(seed: string, size?: number): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(identiconSvg(seed, size))}`
}
