import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  applicationServerKeyMatches,
  unsubscribeFromPush,
  urlBase64ToUint8Array,
} from "./push"

const VAPID = "BPZ9d3xQ0y1nF2kLm4o5p6q7r8s9t0u1v2w3x4y5z6A7B8C9D0E1F2G3H4I5J6K7L8M9N0O1P2Q3R4S5T6U7V8W"

function keyBuffer(key: string): ArrayBuffer {
  const bytes = urlBase64ToUint8Array(key)
  return bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer
}

describe("applicationServerKeyMatches", () => {
  it("returns true for the same key bytes", () => {
    expect(applicationServerKeyMatches(keyBuffer(VAPID), VAPID)).toBe(true)
  })

  it("returns false for a different key", () => {
    const other = VAPID.slice(0, -2) + "AA"
    expect(applicationServerKeyMatches(keyBuffer(other), VAPID)).toBe(false)
  })

  it("returns false when the subscription has no key", () => {
    expect(applicationServerKeyMatches(null, VAPID)).toBe(false)
    expect(applicationServerKeyMatches(undefined, VAPID)).toBe(false)
  })

  it("returns false on length mismatch", () => {
    expect(
      applicationServerKeyMatches(keyBuffer(VAPID.slice(0, 20)), VAPID),
    ).toBe(false)
  })
})

describe("unsubscribeFromPush", () => {
  const fetchMock = vi.fn()
  const unsubscribeMock = vi.fn().mockResolvedValue(true)

  function installFakeRegistration(sub: unknown): void {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: () => Promise.resolve(sub) },
        }),
      },
    })
  }

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 204 })
    unsubscribeMock.mockClear()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    })
  })

  it("DELETEs /api/push/subscribe with the endpoint (the route that exists)", async () => {
    installFakeRegistration({
      endpoint: "https://push.example/ep",
      unsubscribe: unsubscribeMock,
    })

    const result = await unsubscribeFromPush("key123")

    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/push/subscribe")
    expect(init.method).toBe("DELETE")
    expect(JSON.parse(init.body as string)).toEqual({
      endpoint: "https://push.example/ep",
    })
    expect(
      (init.headers as Record<string, string>).authorization,
    ).toBe("Bearer key123")
    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
  })

  it("still unsubscribes locally and logs when the server call fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    fetchMock.mockResolvedValue({ ok: false, status: 404 })
    installFakeRegistration({
      endpoint: "https://push.example/ep",
      unsubscribe: unsubscribeMock,
    })

    const result = await unsubscribeFromPush()

    expect(result).toBe(true)
    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it("returns false when no subscription exists", async () => {
    installFakeRegistration(null)
    expect(await unsubscribeFromPush()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
