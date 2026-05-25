import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render } from "@testing-library/react"

/**
 * Contract: in production (`import.meta.env.DEV === false`) `<DevtoolsGate />`
 * resolves to `null` AND must NOT pull `@tanstack/react-query-devtools` into
 * the module graph. The build-side check (`verify-build`) confirms the
 * package text is absent from `dist/`; this test confirms the runtime
 * branch is the inert one.
 */

describe("DevtoolsGate", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("renders nothing when import.meta.env.DEV is false", async () => {
    vi.stubEnv("DEV", false)
    const { DevtoolsGate } = await import("@/DevtoolsGate")
    const { container } = render(<DevtoolsGate />)
    expect(container.innerHTML).toBe("")
  })

  it("returns a non-null element when import.meta.env.DEV is true", async () => {
    vi.stubEnv("DEV", true)
    const { DevtoolsGate } = await import("@/DevtoolsGate")
    // The gate returns a <Suspense> wrapper whose lazy child resolves
    // asynchronously; before resolution the Suspense fallback (null) is
    // rendered, but the React element itself is not null.
    const element = DevtoolsGate()
    expect(element).not.toBeNull()
  })
})
