/**
 * behaviourQueries.test.tsx
 *
 * One happy-path test per hook, verifying URL + body shape sent to the API.
 * All API calls and toasts are mocked at module level.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

vi.mock("@/lib/api", () => ({
  api: { post: vi.fn(), get: vi.fn(), put: vi.fn() },
  isApiError: (e: unknown): boolean => e instanceof Error && "status" in e,
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { api } from "@/lib/api"
import { toast } from "sonner"
import {
  useSetDeviceName,
  useUpdatePolicy,
  useSetBlePin,
  useCustomVars,
  useSetCustomVar,
  useDeviceTime,
  useSyncDeviceTime,
} from "../behaviourQueries"

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

// ---------------------------------------------------------------------------
// useSetDeviceName
// ---------------------------------------------------------------------------
describe("useSetDeviceName", () => {
  it("posts { name } to /api/device/name and invalidates self-info", async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)
    const qc = makeClient()
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")
    const { result } = renderHook(() => useSetDeviceName(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ name: "test-node" })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith("/api/device/name", { name: "test-node" })
    expect(toast.success).toHaveBeenCalledWith("Device name updated")
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["device", "self-info"],
    })
  })

  it("calls notifyError on failure", async () => {
    const err = Object.assign(new Error("503"), { status: 503 })
    ;(api.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err)
    const qc = makeClient()
    const { result } = renderHook(() => useSetDeviceName(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ name: "fail" })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toast.error).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// useUpdatePolicy
// ---------------------------------------------------------------------------
describe("useUpdatePolicy", () => {
  it("posts partial policy body to /api/device/policy", async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)
    const qc = makeClient()
    const { result } = renderHook(() => useUpdatePolicy(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ telemetry: { base: 2, loc: 1 } })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith("/api/device/policy", {
      telemetry: { base: 2, loc: 1 },
    })
    expect(toast.success).toHaveBeenCalledWith("Policy updated")
  })

  it("posts adv_loc_policy + manual_add_contacts + multi_acks", async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)
    const qc = makeClient()
    const { result } = renderHook(() => useUpdatePolicy(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({
      adv_loc_policy: 5,
      manual_add_contacts: true,
      multi_acks: 3,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith("/api/device/policy", {
      adv_loc_policy: 5,
      manual_add_contacts: true,
      multi_acks: 3,
    })
  })

  it("calls notifyError on failure", async () => {
    const err = Object.assign(new Error("502"), { status: 502 })
    ;(api.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err)
    const qc = makeClient()
    const { result } = renderHook(() => useUpdatePolicy(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({})
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toast.error).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// useSetBlePin
// ---------------------------------------------------------------------------
describe("useSetBlePin", () => {
  it("posts { pin } to /api/device/ble-pin", async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)
    const qc = makeClient()
    const { result } = renderHook(() => useSetBlePin(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ pin: 123456 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith("/api/device/ble-pin", { pin: 123456 })
    expect(toast.success).toHaveBeenCalledWith("BLE PIN set")
  })

  it("calls notifyError on failure", async () => {
    const err = Object.assign(new Error("503"), { status: 503 })
    ;(api.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err)
    const qc = makeClient()
    const { result } = renderHook(() => useSetBlePin(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ pin: 0 })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toast.error).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// useCustomVars
// ---------------------------------------------------------------------------
describe("useCustomVars", () => {
  it("fetches /api/device/custom-vars and returns the map", async () => {
    const payload = { rx_offset_hz: -1300, notes: "test rig" }
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(payload)
    const qc = makeClient()
    const { result } = renderHook(() => useCustomVars(), {
      wrapper: makeWrapper(qc),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith("/api/device/custom-vars")
    expect(result.current.data).toEqual(payload)
  })
})

// ---------------------------------------------------------------------------
// useSetCustomVar
// ---------------------------------------------------------------------------
describe("useSetCustomVar", () => {
  it("puts { value } to /api/device/custom-vars/{key} and invalidates", async () => {
    ;(api.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)
    const qc = makeClient()
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")
    const { result } = renderHook(() => useSetCustomVar(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ key: "rx_offset_hz", value: -1300 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.put).toHaveBeenCalledWith(
      "/api/device/custom-vars/rx_offset_hz",
      { value: -1300 },
    )
    expect(toast.success).toHaveBeenCalledWith("Custom variable saved")
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["device", "custom-vars"],
    })
  })

  it("encodes special characters in the key", async () => {
    ;(api.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)
    const qc = makeClient()
    const { result } = renderHook(() => useSetCustomVar(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ key: "my-key_1", value: "hello" })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.put).toHaveBeenCalledWith(
      "/api/device/custom-vars/my-key_1",
      { value: "hello" },
    )
  })

  it("calls notifyError on failure", async () => {
    const err = Object.assign(new Error("503"), { status: 503 })
    ;(api.put as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err)
    const qc = makeClient()
    const { result } = renderHook(() => useSetCustomVar(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ key: "k", value: "v" })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toast.error).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// useDeviceTime
// ---------------------------------------------------------------------------
describe("useDeviceTime", () => {
  it("fetches /api/device/time and returns the payload", async () => {
    const payload = { device_epoch: 1748000000, server_epoch: 1748000003, skew_s: -3 }
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(payload)
    const qc = makeClient()
    const { result } = renderHook(() => useDeviceTime(), {
      wrapper: makeWrapper(qc),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.get).toHaveBeenCalledWith("/api/device/time")
    expect(result.current.data).toEqual(payload)
  })
})

// ---------------------------------------------------------------------------
// useSyncDeviceTime
// ---------------------------------------------------------------------------
describe("useSyncDeviceTime", () => {
  it("posts to /api/device/time/sync and invalidates time query", async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)
    const qc = makeClient()
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")
    const { result } = renderHook(() => useSyncDeviceTime(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith("/api/device/time/sync", {})
    expect(toast.success).toHaveBeenCalledWith("Time synced to server")
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["device", "time"],
    })
  })

  it("calls notifyError on failure", async () => {
    const err = Object.assign(new Error("503"), { status: 503 })
    ;(api.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err)
    const qc = makeClient()
    const { result } = renderHook(() => useSyncDeviceTime(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate()
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toast.error).toHaveBeenCalled()
  })
})
