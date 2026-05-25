import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { IDBFactory } from "fake-indexeddb"
import "fake-indexeddb/auto"
import {
  stashPendingResubscribe,
} from "@/sw/pendingResubscribe"

// We mock the API wrapper so tests don't actually touch the network and we
// can assert on the exact call shape.
const postMock = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/api", () => ({
  api: {
    post: (...args: unknown[]) => postMock(...args),
  },
}))

interface FakeSW {
  listeners: Array<(event: MessageEvent) => void>
  addEventListener: (type: string, fn: (event: MessageEvent) => void) => void
  removeEventListener: (
    type: string,
    fn: (event: MessageEvent) => void,
  ) => void
  emit: (data: unknown) => void
}

function installFakeServiceWorker(): FakeSW {
  const listeners: Array<(event: MessageEvent) => void> = []
  const fake: FakeSW = {
    listeners,
    addEventListener: (type, fn) => {
      if (type === "message") listeners.push(fn)
    },
    removeEventListener: (type, fn) => {
      if (type !== "message") return
      const i = listeners.indexOf(fn)
      if (i >= 0) listeners.splice(i, 1)
    },
    emit: (data) => {
      const event = { data } as MessageEvent
      for (const fn of [...listeners]) fn(event)
    },
  }
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: fake,
  })
  return fake
}

// Flush a few macrotask cycles so any fire-and-forget IDB / mock-API promises
// installed by `installResubscribeBridge` settle before we move on. Without
// this, an in-flight `replayPendingResubscribe` from one test can resolve
// during the next test and inflate `postMock.mock.calls`.
async function flushPending(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0))
  }
}

beforeEach(async () => {
  // Swap in a fresh IndexedDB so no leftover state (or an in-flight
  // connection from a previous test) can interfere. `fake-indexeddb/auto`
  // installed `indexedDB` as a globalThis property; reassigning it gives
  // every test a clean factory with no open databases.
  globalThis.indexedDB = new IDBFactory()
  postMock.mockClear()
})

afterEach(async () => {
  // Drain any fire-and-forget promises kicked off by the bridge before the
  // next test's `mockClear` lands — otherwise a late `api.post` from one
  // test pollutes another.
  await flushPending()
  // Restore navigator.serviceWorker to whatever jsdom left (likely undefined).
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: undefined,
  })
})

describe("installResubscribeBridge", () => {
  it("forwards SW PUSH_RESUBSCRIBE messages to /api/push/resubscribe", async () => {
    const sw = installFakeServiceWorker()
    const { installResubscribeBridge } = await import("./push")
    const teardown = installResubscribeBridge()

    const payload = {
      old_endpoint: "https://push.example/old",
      new: {
        endpoint: "https://push.example/new",
        keys: { p256dh: "p".repeat(20), auth: "a".repeat(20) },
        expirationTime: null,
      },
    }
    sw.emit({ type: "PUSH_RESUBSCRIBE", payload })
    // The handler is fire-and-forget; let microtasks flush.
    await Promise.resolve()
    await Promise.resolve()

    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock).toHaveBeenCalledWith("/api/push/resubscribe", payload)
    teardown()
  })

  it("ignores postMessages with a different type", async () => {
    const sw = installFakeServiceWorker()
    const { installResubscribeBridge } = await import("./push")
    const teardown = installResubscribeBridge()
    sw.emit({ type: "SKIP_WAITING" })
    sw.emit({ type: "OTHER", payload: { x: 1 } })
    await Promise.resolve()
    expect(postMock).not.toHaveBeenCalled()
    teardown()
  })

  it("teardown detaches the message listener", async () => {
    const sw = installFakeServiceWorker()
    const { installResubscribeBridge } = await import("./push")
    const teardown = installResubscribeBridge()
    teardown()
    expect(sw.listeners.length).toBe(0)
  })

  it("drains a pending IndexedDB payload on install", async () => {
    const payload = {
      old_endpoint: "https://push.example/stashed-old",
      new: {
        endpoint: "https://push.example/stashed-new",
        keys: { p256dh: "p".repeat(20), auth: "a".repeat(20) },
        expirationTime: null,
      },
    }
    await stashPendingResubscribe(payload)
    installFakeServiceWorker()
    const { installResubscribeBridge } = await import("./push")
    const teardown = installResubscribeBridge()
    // Allow the async replay (open db → read → delete → tx.oncomplete →
    // post) to complete. IndexedDB needs several macrotask cycles before
    // `api.post` actually fires.
    await flushPending()
    expect(postMock).toHaveBeenCalledWith("/api/push/resubscribe", payload)
    teardown()
  })

  it("no-ops when serviceWorker is unavailable", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    })
    const { installResubscribeBridge } = await import("./push")
    const teardown = installResubscribeBridge()
    // No throw, no calls.
    expect(postMock).not.toHaveBeenCalled()
    teardown()
  })
})
