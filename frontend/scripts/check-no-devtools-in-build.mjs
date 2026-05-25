#!/usr/bin/env node
/**
 * Fails if any production-built JS/HTML asset under `dist/` contains a
 * fingerprint of `@tanstack/react-query-devtools`.
 *
 * The devtools panel exposes the entire TanStack Query cache (pubkeys,
 * API responses, timings). It must never ship in a production bundle.
 *
 * Run after `pnpm build`:
 *   pnpm run verify-build
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOT = "dist"
const NEEDLES = [
  "ReactQueryDevtools",
  "@tanstack/react-query-devtools",
  "react-query-devtools",
]

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) yield* walk(p)
    else yield p
  }
}

const bad = []
let scanned = 0
for (const file of walk(ROOT)) {
  if (!/\.(js|mjs|cjs|html)$/.test(file)) continue
  scanned += 1
  const txt = readFileSync(file, "utf8")
  for (const needle of NEEDLES) {
    if (txt.includes(needle)) {
      bad.push(`${file}: contains "${needle}"`)
      break
    }
  }
}

if (bad.length) {
  console.error("FAIL: devtools content found in production build:")
  for (const b of bad) console.error("  " + b)
  process.exit(1)
}
console.log(
  `OK: production build is devtools-free (scanned ${scanned} files under ${ROOT}/)`,
)
