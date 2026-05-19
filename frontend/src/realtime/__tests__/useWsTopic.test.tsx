import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { WebSocketContext } from "../WebSocketProvider"
import { useWsTopic } from "../useWsTopic"

interface FakeProvider {
  wrapper: ({ children }: { children: ReactNode }) => JSX.Element
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
})
