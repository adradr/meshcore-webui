import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  WebSocketContext,
  type WebSocketContextValue,
} from "@/realtime/WebSocketProvider"
import { useRxLog } from "../api"
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

describe("useRxLog", () => {
  it("seeds from REST then appends WS events", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [
        { pkt_hash: "aa", snr: 1.0 },
        { pkt_hash: "bb", snr: 2.0 },
      ],
      total_buffered: 2,
      returned: 2,
    })
    const ws = makeWsCtx()
    const { result } = renderHook(() => useRxLog(), {
      wrapper: makeWrapper(ws.value),
    })
    await waitFor(() => expect(result.current.data?.length).toBe(2))
    act(() => ws.dispatch("rx_log", { pkt_hash: "cc", snr: 3.0 }))
    await waitFor(() => expect(result.current.data?.length).toBe(3))
    expect(result.current.data?.[2].pkt_hash).toBe("cc")
  })

  it("ignores WS events when paused", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [],
      total_buffered: 0,
      returned: 0,
    })
    const ws = makeWsCtx()
    const { result } = renderHook(() => useRxLog({ paused: true }), {
      wrapper: makeWrapper(ws.value),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    act(() => ws.dispatch("rx_log", { pkt_hash: "x", snr: 1.0 }))
    expect(result.current.data?.length).toBe(0)
  })

  it("trims to MAX_CLIENT_BUFFER on overflow", async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      pkt_hash: `seed${i}`,
      snr: 0,
    }))
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items,
      total_buffered: 50,
      returned: 50,
    })
    const ws = makeWsCtx()
    const { result } = renderHook(() => useRxLog(), {
      wrapper: makeWrapper(ws.value),
    })
    await waitFor(() => expect(result.current.data?.length).toBe(50))
    act(() => {
      for (let i = 0; i < 1500; i++) {
        ws.dispatch("rx_log", { pkt_hash: `live${i}`, snr: 0 })
      }
    })
    await waitFor(() => expect(result.current.data?.length).toBe(1000))
    // Should keep the LAST 1000 (newest). 50 seed + 1500 live = 1550; trim to
    // 1000 → starts at index 550 of the live stream → live500.
    expect(result.current.data?.[0].pkt_hash).toBe("live500")
    expect(result.current.data?.at(-1)?.pkt_hash).toBe("live1499")
  })
})
