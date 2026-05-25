import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactElement, ReactNode } from "react"
import { WebSocketContext } from "../WebSocketProvider"
import { useWsTopic } from "../useWsTopic"

interface FakeProvider {
  wrapper: ({ children }: { children: ReactNode }) => ReactElement
  dispatch: (topic: string, payload: unknown) => void
}

function makeFakeProvider(): FakeProvider {
  const subs = new Map<string, Set<(p: unknown) => void>>()
  const subscribe = (topic: string, h: (p: unknown) => void) => {
    let set = subs.get(topic)
    if (!set) {
      set = new Set()
      subs.set(topic, set)
    }
    set.add(h)
    return () => {
      subs.get(topic)?.delete(h)
    }
  }
  const dispatch = (topic: string, payload: unknown) => {
    subs.get(topic)?.forEach((h) => h(payload))
  }
  const value = {
    status: "open" as const,
    send: () => {},
    lastMessage: null,
    subscribe,
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  )
  return { wrapper, dispatch }
}

describe("useWsTopic", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it("fires the handler when topic matches", () => {
    const cb = vi.fn()
    const { wrapper, dispatch } = makeFakeProvider()
    renderHook(() => useWsTopic("rx_log", cb), { wrapper })
    dispatch("rx_log", { bar: 2 })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith({ bar: 2 })
  })

  it("does not fire the handler when topic differs", () => {
    const cb = vi.fn()
    const { wrapper, dispatch } = makeFakeProvider()
    renderHook(() => useWsTopic("rx_log", cb), { wrapper })
    dispatch("messages", { foo: 1 })
    expect(cb).not.toHaveBeenCalled()
  })

  it("unsubscribes on unmount", () => {
    const cb = vi.fn()
    const { wrapper, dispatch } = makeFakeProvider()
    const { unmount } = renderHook(() => useWsTopic("noise", cb), { wrapper })
    unmount()
    dispatch("noise", { x: 1 })
    expect(cb).not.toHaveBeenCalled()
  })

  it("resubscribes when topic changes", () => {
    const cb = vi.fn()
    const { wrapper, dispatch } = makeFakeProvider()
    const { rerender } = renderHook(
      ({ topic }: { topic: string }) => useWsTopic(topic, cb),
      { wrapper, initialProps: { topic: "a" } },
    )
    dispatch("a", 1)
    expect(cb).toHaveBeenCalledTimes(1)
    rerender({ topic: "b" })
    dispatch("a", 2)
    expect(cb).toHaveBeenCalledTimes(1)
    dispatch("b", 3)
    expect(cb).toHaveBeenCalledTimes(2)
    expect(cb).toHaveBeenLastCalledWith(3)
  })

  // --- Per-topic Zod validation (Task 4.6) -------------------------------

  it("forwards a valid noise payload", () => {
    const cb = vi.fn()
    const { wrapper, dispatch } = makeFakeProvider()
    renderHook(() => useWsTopic("noise", cb), { wrapper })
    const sample = {
      noise_floor: -97.5,
      last_rssi: -110,
      last_snr: 3.4,
      tx_air_secs: 0,
      rx_air_secs: 0,
      t_ms: 1_700_000_000_000,
    }
    dispatch("noise", sample)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(sample)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("drops a noise payload with a non-numeric t_ms", () => {
    const cb = vi.fn()
    const { wrapper, dispatch } = makeFakeProvider()
    renderHook(() => useWsTopic("noise", cb), { wrapper })
    dispatch("noise", { noise_floor: -97, t_ms: "not-a-number" })
    expect(cb).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[1]).toBe("noise")
  })

  it("drops a noise payload with t_ms missing entirely", () => {
    const cb = vi.fn()
    const { wrapper, dispatch } = makeFakeProvider()
    renderHook(() => useWsTopic("noise", cb), { wrapper })
    dispatch("noise", { noise_floor: -97 })
    expect(cb).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it("drops a trace_monitor payload missing session_id", () => {
    const cb = vi.fn()
    const { wrapper, dispatch } = makeFakeProvider()
    renderHook(() => useWsTopic("trace_monitor", cb), { wrapper })
    dispatch("trace_monitor", {
      target_pubkey: "ab".repeat(32),
      started_at: "2026-05-25T00:00:00Z",
      finished_at: "2026-05-25T00:00:01Z",
      status: "ok",
      hops: [],
    })
    expect(cb).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[1]).toBe("trace_monitor")
  })

  it("forwards a valid trace_monitor payload", () => {
    const cb = vi.fn()
    const { wrapper, dispatch } = makeFakeProvider()
    renderHook(() => useWsTopic("trace_monitor", cb), { wrapper })
    const sample = {
      session_id: "sess-1",
      target_pubkey: "ab".repeat(32),
      started_at: "2026-05-25T00:00:00Z",
      finished_at: "2026-05-25T00:00:01Z",
      status: "ok" as const,
      path_len: 2,
      snr_there: 4.5,
      snr_back: 3.1,
      hops: [{ hash: "ab", snr: 4.5 }],
      error: null,
    }
    dispatch("trace_monitor", sample)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(sample)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("forwards unknown / unvalidated topics unchanged", () => {
    const cb = vi.fn()
    const { wrapper, dispatch } = makeFakeProvider()
    renderHook(() => useWsTopic("messages", cb), { wrapper })
    // `messages` is NOT in TOPIC_PAYLOAD_SCHEMAS — should pass through
    // verbatim regardless of shape (matches existing behaviour for
    // legacy topic-fanout consumers).
    const garbled = { totally: "arbitrary", shape: [1, 2, 3] }
    dispatch("messages", garbled)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(garbled)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("drops an rx_log payload whose numeric field is a string", () => {
    const cb = vi.fn()
    const { wrapper, dispatch } = makeFakeProvider()
    renderHook(() => useWsTopic("rx_log", cb), { wrapper })
    // `snr` declared as number|null|optional — a string is hostile.
    dispatch("rx_log", { snr: "boom" })
    expect(cb).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
