import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, renderHook, waitFor, act } from "@testing-library/react"
import type { WSStatus } from "@/realtime/useWebSocket"
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

const startSuccessSpy = vi.fn()
vi.mock("@/haptics/HapticProvider", () => ({
  useHaptic: () => ({
    tap: vi.fn(), select: vi.fn(), success: startSuccessSpy,
    warn: vi.fn(), error: vi.fn(), nudge: vi.fn(),
    enabled: true, setEnabled: vi.fn(),
  }),
  getGlobalHaptic: () => null,
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

const IDLE_STATUS = {
  running: false,
  session_id: null,
  target_pubkey: null,
  interval_s: null,
  started_at: null,
  samples_total: null,
  last_sample_at: null,
}

describe("useStartTraceMonitor", () => {
  it("posts to /api/trace/monitor/start with body and refetches status", async () => {
    const pubkey = "ab".repeat(32)
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      session_id: "sid-1",
      target_pubkey: pubkey,
      interval_s: 5,
      started_at: "2026-05-23T12:00:00Z",
    })
    // Status get may be called as part of the post-success invalidation.
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue(IDLE_STATUS)
    const { result } = renderHook(
      () => {
        const status = useTraceMonitorStatus()
        const start = useStartTraceMonitor()
        return { status, start }
      },
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.status.isSuccess).toBe(true))
    result.current.start.mutate({ pubkey, interval_s: 5 })
    await waitFor(() =>
      expect(result.current.start.isSuccess).toBe(true),
    )
    expect(api.post).toHaveBeenCalledWith(
      "/api/trace/monitor/start",
      { pubkey, interval_s: 5 },
      expect.anything(),
    )
    expect(result.current.start.data?.session_id).toBe("sid-1")
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        "/api/trace/monitor/status",
        expect.anything(),
      )
    })
    // Haptic fires the moment the mutation resolves successfully — same
    // instant the panel flips into the "running" state.
    expect(startSuccessSpy).toHaveBeenCalledTimes(1)
  })
})

describe("useStopTraceMonitor", () => {
  it("posts to /api/trace/monitor/stop and refetches status", async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      stopped: true,
    })
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue(IDLE_STATUS)
    const { result } = renderHook(
      () => {
        const status = useTraceMonitorStatus()
        const stop = useStopTraceMonitor()
        return { status, stop }
      },
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.status.isSuccess).toBe(true))
    result.current.stop.mutate()
    await waitFor(() => expect(result.current.stop.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith(
      "/api/trace/monitor/stop",
      {},
      expect.anything(),
    )
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        "/api/trace/monitor/status",
        expect.anything(),
      )
    })
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

  it("enforces 600-sample buffer cap and retains the newest", async () => {
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
            started_at: `2026-05-23T12:00:${i.toString().padStart(3, "0")}Z`,
          }),
        )
      }
    })
    await waitFor(() => expect(result.current.data?.length).toBe(600))
    // Verify the slice trimmed the OLDEST entries, not the newest. Indices
    // 0..99 (oldest 100) should be gone, leaving 100..699.
    expect(result.current.data?.[0].started_at).toBe(
      "2026-05-23T12:00:100Z",
    )
    expect(result.current.data?.at(-1)?.started_at).toBe(
      "2026-05-23T12:00:699Z",
    )
  })

  it("re-fetches samples when the WS reconnects (backfills outage gap)", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      session_id: "sid-x",
      target_pubkey: "ab".repeat(32),
      count: 0,
      items: [],
    })
    const ws = makeWsCtx()
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    function Probe() {
      useTraceMonitorSamples("sid-x")
      return null
    }
    function Harness({ status }: { status: WSStatus }) {
      return (
        <QueryClientProvider client={qc}>
          <WebSocketContext.Provider value={{ ...ws.value, status }}>
            <Probe />
          </WebSocketContext.Provider>
        </QueryClientProvider>
      )
    }
    const { rerender } = render(<Harness status="open" />)
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1))

    // Socket drops, then comes back — the hook must invalidate + refetch so
    // samples produced during the outage land in the cache.
    rerender(<Harness status="closed" />)
    rerender(<Harness status="open" />)
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))

    // A status flap that never leaves "open" must NOT refetch again.
    rerender(<Harness status="open" />)
    await act(async () => {})
    expect(api.get).toHaveBeenCalledTimes(2)
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
