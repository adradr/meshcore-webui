import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

import {
  WebSocketContext,
  type WebSocketContextValue,
} from "@/realtime/WebSocketProvider"

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  isApiError: (e: unknown): boolean => e instanceof Error && "status" in e,
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { api } from "@/lib/api"
import {
  useDeleteTraceMonitorSession,
  useStartTraceMonitor,
  useStopTraceMonitor,
  useTraceMonitorSamples,
  useTraceMonitorSessions,
  useTraceMonitorStatus,
  type TraceSample,
} from "../api"

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
    lastMessage: null,
  } as unknown as WebSocketContextValue
  return { value, dispatch }
}

function makeWrapper(wsValue?: WebSocketContextValue) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const inner = wsValue ? (
      <WebSocketContext.Provider value={wsValue}>
        {children}
      </WebSocketContext.Provider>
    ) : (
      children
    )
    return <QueryClientProvider client={qc}>{inner}</QueryClientProvider>
  }
}

function sample(overrides: Partial<TraceSample> = {}): TraceSample {
  return {
    session_id: "session-a",
    target_pubkey: "ab".repeat(32),
    started_at: "2026-05-23T12:00:00Z",
    finished_at: "2026-05-23T12:00:01Z",
    status: "ok",
    path_len: 2,
    snr_there: -4,
    snr_back: -7,
    hops: [{ hash: "ab", snr: -4 }],
    error: null,
    ...overrides,
  }
}

beforeEach(() => {
  ;(api.get as ReturnType<typeof vi.fn>).mockReset()
  ;(api.post as ReturnType<typeof vi.fn>).mockReset()
  ;(api.delete as ReturnType<typeof vi.fn>).mockReset()
})

describe("useTraceMonitorStatus", () => {
  it("reads from /api/trace/monitor/status", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      running: false,
      session_id: null,
      target_pubkey: null,
      interval_s: null,
      started_at: null,
      samples_total: null,
      last_sample_at: null,
    })
    const { result } = renderHook(() => useTraceMonitorStatus(), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith(
      "/api/trace/monitor/status",
      expect.anything(),
    )
    expect(result.current.data?.running).toBe(false)
  })
})

describe("useStartTraceMonitor", () => {
  it("posts to /api/trace/monitor/start with body", async () => {
    const pubkey = "ab".repeat(32)
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      session_id: "sid-1",
      target_pubkey: pubkey,
      interval_s: 5,
      started_at: "2026-05-23T12:00:00Z",
    })
    const { result } = renderHook(() => useStartTraceMonitor(), {
      wrapper: makeWrapper(),
    })
    result.current.mutate({ pubkey, interval_s: 5 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith(
      "/api/trace/monitor/start",
      { pubkey, interval_s: 5 },
      expect.anything(),
    )
    expect(result.current.data?.session_id).toBe("sid-1")
  })
})

describe("useStopTraceMonitor", () => {
  it("posts to /api/trace/monitor/stop", async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      stopped: true,
    })
    const { result } = renderHook(() => useStopTraceMonitor(), {
      wrapper: makeWrapper(),
    })
    result.current.mutate()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith(
      "/api/trace/monitor/stop",
      {},
      expect.anything(),
    )
  })
})

describe("useTraceMonitorSamples", () => {
  it("is disabled when sessionId is null", async () => {
    const ws = makeWsCtx()
    const { result } = renderHook(() => useTraceMonitorSamples(null), {
      wrapper: makeWrapper(ws.value),
    })
    // Give react-query a tick.
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"))
    expect(api.get).not.toHaveBeenCalled()
  })

  it("fetches when sessionId is set", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      session_id: "sid-x",
      target_pubkey: "ab".repeat(32),
      count: 1,
      items: [sample({ session_id: "sid-x" })],
    })
    const ws = makeWsCtx()
    const { result } = renderHook(() => useTraceMonitorSamples("sid-x"), {
      wrapper: makeWrapper(ws.value),
    })
    await waitFor(() => expect(result.current.data?.length).toBe(1))
    expect(api.get).toHaveBeenCalledWith(
      "/api/trace/monitor/sid-x/samples?limit=500",
      expect.anything(),
    )
  })

  it("WS handler appends matching samples to cache", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      session_id: "sid-x",
      target_pubkey: "ab".repeat(32),
      count: 0,
      items: [],
    })
    const ws = makeWsCtx()
    const { result } = renderHook(() => useTraceMonitorSamples("sid-x"), {
      wrapper: makeWrapper(ws.value),
    })
    await waitFor(() => expect(result.current.data).toEqual([]))
    act(() =>
      ws.dispatch("trace_monitor", sample({ session_id: "sid-x" })),
    )
    await waitFor(() => expect(result.current.data?.length).toBe(1))
  })

  it("WS handler ignores non-matching session_id", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      session_id: "sid-x",
      target_pubkey: "ab".repeat(32),
      count: 0,
      items: [],
    })
    const ws = makeWsCtx()
    const { result } = renderHook(() => useTraceMonitorSamples("sid-x"), {
      wrapper: makeWrapper(ws.value),
    })
    await waitFor(() => expect(result.current.data).toEqual([]))
    act(() =>
      ws.dispatch("trace_monitor", sample({ session_id: "other" })),
    )
    expect(result.current.data?.length).toBe(0)
  })

  it("enforces 600-sample buffer cap", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      session_id: "sid-x",
      target_pubkey: "ab".repeat(32),
      count: 0,
      items: [],
    })
    const ws = makeWsCtx()
    const { result } = renderHook(() => useTraceMonitorSamples("sid-x"), {
      wrapper: makeWrapper(ws.value),
    })
    await waitFor(() => expect(result.current.data).toEqual([]))
    act(() => {
      for (let i = 0; i < 700; i++) {
        ws.dispatch(
          "trace_monitor",
          sample({
            session_id: "sid-x",
            started_at: `2026-05-23T12:00:${i}Z`,
          }),
        )
      }
    })
    await waitFor(() => expect(result.current.data?.length).toBe(600))
  })
})

describe("useTraceMonitorSessions", () => {
  it("fetches sessions without pubkey filter", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      count: 0,
      items: [],
    })
    const { result } = renderHook(() => useTraceMonitorSessions(), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith(
      "/api/trace/monitor/sessions?limit=20",
      expect.anything(),
    )
  })

  it("fetches sessions with pubkey filter", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      count: 0,
      items: [],
    })
    const pubkey = "cd".repeat(32)
    const { result } = renderHook(
      () => useTraceMonitorSessions({ pubkey }),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith(
      `/api/trace/monitor/sessions?limit=20&pubkey=${pubkey}`,
      expect.anything(),
    )
  })
})

describe("useDeleteTraceMonitorSession", () => {
  it("DELETEs and invalidates session + samples caches", async () => {
    ;(api.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      deleted: 7,
    })
    const { result } = renderHook(() => useDeleteTraceMonitorSession(), {
      wrapper: makeWrapper(),
    })
    result.current.mutate("sid-x")
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.delete).toHaveBeenCalledWith(
      "/api/trace/monitor/sessions/sid-x",
      undefined,
      expect.anything(),
    )
    expect(result.current.data?.deleted).toBe(7)
  })
})
