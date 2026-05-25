import { lazy, Suspense, type ReactElement } from "react"

/**
 * Production-stripped gate around `@tanstack/react-query-devtools`.
 *
 * The devtools panel exposes the full TanStack Query cache (pubkeys, API
 * responses, timings) and ships a UI anyone with physical access can open.
 * It has no place in a production bundle.
 *
 * We rely on Vite's static `import.meta.env.DEV` substitution: in a
 * production build the constant becomes `false`, the ternary collapses,
 * the `lazy(() => import(...))` call is unreachable, and the entire
 * `@tanstack/react-query-devtools` module graph is tree-shaken out of the
 * emitted bundle.
 *
 * Verified by `scripts/check-no-devtools-in-build.mjs`.
 */
const LazyDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((m) => ({
        default: m.ReactQueryDevtools,
      })),
    )
  : null

export function DevtoolsGate(): ReactElement | null {
  if (!LazyDevtools) return null
  return (
    <Suspense fallback={null}>
      <LazyDevtools initialIsOpen={false} />
    </Suspense>
  )
}
