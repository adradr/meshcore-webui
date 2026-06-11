import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  WebSocketContext,
  type WebSocketContextValue,
} from "@/realtime/WebSocketProvider"
import { useNoiseSamples } from "../api"
import type { ReactNode } from "react"

vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }))
import { api } from "@/lib/api"

function makeWsCtx() {
  const subs = new Map<string, Set<(p: unknown) => void>>()
  const subscribe = (topic: string, h: (p: unknown) => void) => {
    if (!subs.has(topic)) subs.set(topic, new Set())
    subs.get(topic)!.add(h)
    return () => {
      subs.get(topic)!.delete(h)
    }
  }
  const dispatch = (topic: string, payload: unknown) => {
    subs.get(topic)?.forEach((h) => h(payload))
  }
  const value = {
    subscribe,
    status: "open" as const,
    send: () => {},
  } as unknown as WebSocketContextValue
  return { value, dispatch }
}

function makeWrapper(wsValue: WebSocketContextValue) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return (
      <QueryClientProvider client={qc}>
        <WebSocketContext.Provider value={wsValue}>
          {children}
        </WebSocketContext.Provider>
      </QueryClientProvider>
    )
  }
}

describe("useNoiseSamples", () => {
  it("seeds from REST then appends WS samples", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [
        { t_ms: 1000, noise_floor: -120 },
        { t_ms: 2000, noise_floor: -119 },
      ],
      count: 2,
    })
    const ws = makeWsCtx()
    const { result } = renderHook(() => useNoiseSamples(), {
      wrapper: makeWrapper(ws.value),
    })
    await waitFor(() => expect(result.current.data?.length).toBe(2))
    act(() => ws.dispatch("noise", { t_ms: 3000, noise_floor: -118 }))
    await waitFor(() => expect(result.current.data?.length).toBe(3))
    expect(result.current.data?.[2].t_ms).toBe(3000)
  })

  it("ignores WS samples when paused", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [],
      count: 0,
    })
    const ws = makeWsCtx()
    const { result } = renderHook(() => useNoiseSamples({ paused: true }), {
      wrapper: makeWrapper(ws.value),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    act(() => ws.dispatch("noise", { t_ms: 1, noise_floor: -120 }))
    expect(result.current.data?.length).toBe(0)
  })

  it("trims to MAX_CLIENT_BUFFER on overflow", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [],
      count: 0,
    })
    const ws = makeWsCtx()
    const { result } = renderHook(() => useNoiseSamples(), {
      wrapper: makeWrapper(ws.value),
    })
    // Access .data here so react-query's tracked-props records it; otherwise
    // observers won't notify on data-only updates after dispatch.
    await waitFor(() => expect(result.current.data).toEqual([]))
    act(() => {
      for (let i = 0; i < 500; i++) {
        ws.dispatch("noise", { t_ms: i, noise_floor: -120 - i })
      }
    })
    await waitFor(() => expect(result.current.data?.length).toBe(300))
    expect(result.current.data?.[0].t_ms).toBe(200)
    expect(result.current.data?.at(-1)?.t_ms).toBe(499)
  })
})
