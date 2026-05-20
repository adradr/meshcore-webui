import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

vi.mock("@/lib/api", () => ({
  api: { post: vi.fn(), get: vi.fn() },
  isApiError: (e: unknown): boolean => e instanceof Error && "status" in e,
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { api } from "@/lib/api"
import { toast } from "sonner"
import { useLinkDiagnostic, useLastDiagnostic } from "../api"

const PUBKEY = "ab".repeat(32)

function apiError(status: number, statusText = "", detail = ""): Error {
  const e = new Error(
    detail ? `${status} ${statusText}: ${detail}` : `${status} ${statusText}`,
  ) as Error & { status?: number; statusText?: string; detail?: string }
  e.status = status
  e.statusText = statusText
  e.detail = detail
  return e
}

function makeReport(pubkey = PUBKEY) {
  const now = new Date().toISOString()
  return {
    target_pubkey: pubkey,
    target_name: "Node A",
    contact_type: 1,
    started_at: now,
    finished_at: now,
    steps: [
      {
        step: "ping",
        status: "responded" as const,
        started_at: now,
        finished_at: now,
        data: { rssi: -50 },
        error: null,
        skip_reason: null,
        attempts: 1,
        successes: 1,
      },
    ],
    verdict: "ok",
    verdict_detail: "All good",
  }
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("useLinkDiagnostic", () => {
  it("posts the request body and parses the response", async () => {
    const report = makeReport()
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(report)

    const qc = makeClient()
    const { result } = renderHook(() => useLinkDiagnostic(PUBKEY), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({})

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith(
      `/api/diagnostics/${PUBKEY}/link`,
      {},
      expect.anything(),
    )
    expect(result.current.data?.target_pubkey).toBe(PUBKEY)
    expect(result.current.data?.steps[0].status).toBe("responded")
  })

  it("parsing failure surfaces a friendly toast", async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_path, _body, schema) => {
        return schema.parse({ wrong: "shape" })
      },
    )

    const qc = makeClient()
    const { result } = renderHook(() => useLinkDiagnostic(PUBKEY), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({})

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Link diagnostic"),
    )
  })

  it("503 from backend produces a friendly toast", async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      apiError(503, "Service Unavailable"),
    )

    const qc = makeClient()
    const { result } = renderHook(() => useLinkDiagnostic(PUBKEY), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({})

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Mesh device disconnected"),
    )
  })

  it("on success, seeds the 'last' query cache", async () => {
    const report = makeReport()
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(report)

    const qc = makeClient()
    const { result } = renderHook(() => useLinkDiagnostic(PUBKEY), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({})

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const cached = qc.getQueryData(["diagnostic", PUBKEY, "last"])
    expect(cached).toEqual(result.current.data)
    expect((cached as { target_pubkey: string }).target_pubkey).toBe(PUBKEY)
  })
})

describe("useLastDiagnostic", () => {
  it("disabled when pubkey is undefined", async () => {
    const qc = makeClient()
    const { result } = renderHook(() => useLastDiagnostic(undefined), {
      wrapper: makeWrapper(qc),
    })

    // Give microtask + flush a chance.
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current.isFetched).toBe(false)
    expect(api.get).not.toHaveBeenCalled()
  })

  it("parses a 200 response", async () => {
    const report = makeReport()
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(report)

    const qc = makeClient()
    const { result } = renderHook(() => useLastDiagnostic(PUBKEY), {
      wrapper: makeWrapper(qc),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.target_pubkey).toBe(PUBKEY)
    expect(api.get).toHaveBeenCalledWith(
      `/api/diagnostics/${PUBKEY}/last`,
      expect.anything(),
    )
  })

  it("does not retry on 404", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      apiError(404, "Not Found"),
    )

    // Use a client without the global retry-false override so the hook's
    // own `retry` predicate is the one being tested.
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const { result } = renderHook(() => useLastDiagnostic(PUBKEY), {
      wrapper: makeWrapper(qc),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((api.get as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it("does NOT toast on 404", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      apiError(404, "Not Found"),
    )

    const qc = makeClient()
    const { result } = renderHook(() => useLastDiagnostic(PUBKEY), {
      wrapper: makeWrapper(qc),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toast.error).not.toHaveBeenCalled()
  })
})
