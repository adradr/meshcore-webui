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
import {
  useRadio,
  useSetRadio,
  useSetTxPower,
  useTuning,
  useSetTuning,
} from "../radioQueries"

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

describe("useRadio", () => {
  it("fetches /api/device/radio and returns the readout", async () => {
    const readout = {
      freq: 869.525,
      bw: 250,
      sf: 11,
      cr: 5,
      tx_power: 22,
      max_tx_power: 22,
    }
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(readout)

    const qc = makeClient()
    const { result } = renderHook(() => useRadio(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith("/api/device/radio")
    expect(result.current.data).toEqual(readout)
  })
})

describe("useSetRadio", () => {
  it("posts the config body and calls removeQueries for radio and self-info", async () => {
    const response = { reconnected: true }
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response)

    const qc = makeClient()
    // Seed caches that should be evicted on success.
    qc.setQueryData(["device", "radio"], { freq: 868, bw: 125, sf: 7, cr: 5 })
    qc.setQueryData(["device", "self-info"], { name: "node" })

    const removeSpy = vi.spyOn(qc, "removeQueries")
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")

    const { result } = renderHook(() => useSetRadio(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ freq: 869.525, bw: 250, sf: 11, cr: 5 })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith("/api/device/radio", {
      freq: 869.525,
      bw: 250,
      sf: 11,
      cr: 5,
    })
    expect(toast.success).toHaveBeenCalledWith("Radio configured")

    // Both device-state caches must be evicted (not just invalidated).
    expect(qc.getQueryData(["device", "radio"])).toBeUndefined()
    expect(qc.getQueryData(["device", "self-info"])).toBeUndefined()

    // removeQueries called at least twice (once for each evicted key).
    expect(removeSpy).toHaveBeenCalledTimes(2)
    // Full device tree invalidated as well.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["device"] })
  })

  it("calls notifyError on failure", async () => {
    const err = Object.assign(new Error("503 Service Unavailable"), { status: 503 })
    ;(api.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err)

    const qc = makeClient()
    const { result } = renderHook(() => useSetRadio(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ freq: 868, bw: 125, sf: 7, cr: 5 })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toast.error).toHaveBeenCalled()
  })
})

describe("useSetTxPower", () => {
  it("posts { dbm } to /api/device/tx-power", async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)

    const qc = makeClient()
    const { result } = renderHook(() => useSetTxPower(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate(22)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith("/api/device/tx-power", { dbm: 22 })
    expect(toast.success).toHaveBeenCalledWith("TX power updated")
  })

  it("calls notifyError on failure", async () => {
    const err = Object.assign(new Error("502 Bad Gateway"), { status: 502 })
    ;(api.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err)

    const qc = makeClient()
    const { result } = renderHook(() => useSetTxPower(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate(20)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toast.error).toHaveBeenCalled()
  })
})

describe("useTuning", () => {
  it("fetches /api/device/tuning and returns the params", async () => {
    const params = { rx_delay: 5, airtime_factor: 10 }
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(params)

    const qc = makeClient()
    const { result } = renderHook(() => useTuning(), {
      wrapper: makeWrapper(qc),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith("/api/device/tuning")
    expect(result.current.data).toEqual(params)
  })
})

describe("useSetTuning", () => {
  it("posts the tuning body and invalidates the tuning query", async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)

    const qc = makeClient()
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")

    const { result } = renderHook(() => useSetTuning(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ rx_delay: 5, airtime_factor: 10 })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith("/api/device/tuning", {
      rx_delay: 5,
      airtime_factor: 10,
    })
    expect(toast.success).toHaveBeenCalledWith("RX tuning updated")
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["device", "tuning"],
    })
  })

  it("calls notifyError on failure", async () => {
    const err = Object.assign(new Error("503 Service Unavailable"), { status: 503 })
    ;(api.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err)

    const qc = makeClient()
    const { result } = renderHook(() => useSetTuning(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ rx_delay: 0, airtime_factor: 0 })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toast.error).toHaveBeenCalled()
  })
})
