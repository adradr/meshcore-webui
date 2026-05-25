import { describe, it, expect, vi } from "vitest"
import { installSkipWaitingGate } from "./skipWaitingGate"

describe("installSkipWaitingGate", () => {
  it("does not call skipWaiting at install time", () => {
    const sw = {
      skipWaiting: vi.fn(),
      addEventListener: vi.fn(),
    } as unknown as ServiceWorkerGlobalScope
    installSkipWaitingGate(sw)
    expect(sw.skipWaiting).not.toHaveBeenCalled()
  })

  it("calls skipWaiting when a SKIP_WAITING message arrives", () => {
    const handlers: Record<string, (e: unknown) => void> = {}
    const sw = {
      skipWaiting: vi.fn(),
      addEventListener: vi.fn((type: string, fn: (e: unknown) => void) => {
        handlers[type] = fn
      }),
    } as unknown as ServiceWorkerGlobalScope
    installSkipWaitingGate(sw)
    handlers["message"]({ data: { type: "SKIP_WAITING" } })
    expect(sw.skipWaiting).toHaveBeenCalledOnce()
  })

  it("ignores unrelated messages", () => {
    const handlers: Record<string, (e: unknown) => void> = {}
    const sw = {
      skipWaiting: vi.fn(),
      addEventListener: vi.fn((type: string, fn: (e: unknown) => void) => {
        handlers[type] = fn
      }),
    } as unknown as ServiceWorkerGlobalScope
    installSkipWaitingGate(sw)
    handlers["message"]({ data: { type: "SOMETHING_ELSE" } })
    handlers["message"]({ data: null })
    handlers["message"]({})
    expect(sw.skipWaiting).not.toHaveBeenCalled()
  })
})
