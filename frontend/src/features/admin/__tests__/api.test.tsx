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

const warnSpy = vi.fn()
const successSpy = vi.fn()
const errorSpy = vi.fn()
vi.mock("@/haptics/HapticProvider", () => ({
  useHaptic: () => ({
    tap: vi.fn(), select: vi.fn(), success: successSpy,
    warn: warnSpy, error: errorSpy, nudge: vi.fn(),
    enabled: true, setEnabled: vi.fn(),
  }),
  getGlobalHaptic: () => ({
    tap: vi.fn(), select: vi.fn(), success: successSpy,
    warn: warnSpy, error: errorSpy, nudge: vi.fn(),
    enabled: true, setEnabled: vi.fn(),
  }),
}))

import { api } from "@/lib/api"
import { toast } from "sonner"
import { useReset, useDeviceFactoryReset, type ResetResult } from "../api"

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

describe("useReset", () => {
  it("posts the body to /api/admin/reset and parses the result", async () => {
    const response: ResetResult = {
      local: {
        messages: 5,
        diagnostic_runs: null,
        rx_log: null,
        mutes: null,
        settings: null,
        push_subscribers: null,
        trace_samples: null,
      },
      device: {
        cleared_channels: 2,
        coords_reset: true,
        removed_contacts: null,
        rebooted: false,
        reconnected: false,
      },
    }
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response)

    const qc = makeClient()
    const { result } = renderHook(() => useReset(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({
      local: { messages: true },
      device: { channels: true, coords: true },
      confirm: "RESET",
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith("/api/admin/reset", {
      local: { messages: true },
      device: { channels: true, coords: true },
      confirm: "RESET",
    })
    expect(result.current.data).toEqual(response)
    // 3 targets reported non-null: messages (5), cleared_channels (2),
    // coords_reset (true). removed_contacts (null) doesn't count.
    expect(toast.success).toHaveBeenCalledWith(
      "Reset complete — 3 target(s) cleared",
    )
  })

  it("422 from backend surfaces friendly error toast", async () => {
    const err = new Error("422 Unprocessable Entity: confirm must equal RESET")
    ;(err as Error & { status?: number; detail?: string }).status = 422
    ;(err as Error & { status?: number; detail?: string }).detail =
      "confirm must equal RESET"
    ;(api.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err)

    const qc = makeClient()
    const { result } = renderHook(() => useReset(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ local: {}, device: {}, confirm: "" })

    await waitFor(() => expect(result.current.isError).toBe(true))
    // notifyError maps 422 → "<prefix> failed — <detail>" pattern. The
    // friendlyMessage helper returns `detail || \`${prefix} rejected by device\``
    // for 422, so it surfaces the backend detail verbatim.
    expect(toast.error).toHaveBeenCalledWith("confirm must equal RESET")
  })

  it("on success: removes device-state queries and invalidates others", async () => {
    const response: ResetResult = {
      local: {
        messages: 3, diagnostic_runs: null, rx_log: null,
        mutes: null, settings: null, push_subscribers: null,
        trace_samples: null,
      },
      device: {
        cleared_channels: null, coords_reset: false,
        removed_contacts: 7, rebooted: true, reconnected: true,
      },
    }
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response)

    const qc = makeClient()
    // Seed caches that should be cleared by the reset.
    qc.setQueryData(["contacts"], { "k1": { adv_name: "Alice" } })
    qc.setQueryData(["channels"], [{ idx: 1, name: "Friends" }])
    qc.setQueryData(["device", "self-info"], { name: "node" })
    qc.setQueryData(["threads"], [{ key: "k1" }])
    // Seed a cache that should be invalidated (kept, just marked stale).
    qc.setQueryData(["mutes"], { "k1": true })

    const removeSpy = vi.spyOn(qc, "removeQueries")
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")
    const cancelSpy = vi.spyOn(qc, "cancelQueries")

    const { result } = renderHook(() => useReset(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({
      local: { messages: true },
      device: { contacts: true, reboot: true },
      confirm: "RESET",
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(cancelSpy).toHaveBeenCalled()
    // Device-state caches MUST be evicted entirely so the next mount
    // shows a loading skeleton instead of stale rows.
    expect(qc.getQueryData(["contacts"])).toBeUndefined()
    expect(qc.getQueryData(["channels"])).toBeUndefined()
    expect(qc.getQueryData(["device", "self-info"])).toBeUndefined()
    expect(qc.getQueryData(["threads"])).toBeUndefined()
    // Local-side caches survive (still in cache, marked stale).
    expect(qc.getQueryData(["mutes"])).toEqual({ "k1": true })

    expect(removeSpy).toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalled()
  })

  it("awaits cancelQueries before evicting caches (no stale re-seed race)", async () => {
    const response: ResetResult = {
      local: {
        messages: 0, diagnostic_runs: null, rx_log: null,
        mutes: null, settings: null, push_subscribers: null,
        trace_samples: null,
      },
      device: {
        cleared_channels: null, coords_reset: false,
        removed_contacts: null, rebooted: false, reconnected: false,
      },
    }
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response)

    const qc = makeClient()
    let resolveCancel: () => void = () => {}
    const cancelSpy = vi
      .spyOn(qc, "cancelQueries")
      .mockImplementation(
        () => new Promise<void>((resolve) => { resolveCancel = resolve }),
      )
    const removeSpy = vi.spyOn(qc, "removeQueries")

    const { result } = renderHook(() => useReset(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ local: { messages: true }, confirm: "RESET" })

    // cancelQueries fires, but evictions must NOT happen until it settles —
    // otherwise an in-flight pre-reset fetch can re-seed the cache after
    // removeQueries ran.
    await waitFor(() => expect(cancelSpy).toHaveBeenCalled())
    expect(removeSpy).not.toHaveBeenCalled()

    resolveCancel()
    await waitFor(() => expect(removeSpy).toHaveBeenCalled())
  })
})

describe("useReset — haptic wiring", () => {
  it("fires warn on mutate (kickoff) and success on settle (success path)", async () => {
    const response: ResetResult = {
      local: {
        messages: 1, diagnostic_runs: null, rx_log: null,
        mutes: null, settings: null, push_subscribers: null,
        trace_samples: null,
      },
      device: {
        cleared_channels: null, coords_reset: false,
        removed_contacts: null, rebooted: false, reconnected: false,
      },
    }
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response)

    const qc = makeClient()
    const { result } = renderHook(() => useReset(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ local: { messages: true }, confirm: "RESET" })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // warn must fire EXACTLY ONCE at the start (destructive confirm) —
    // success comes via notifySuccess from the toast helper, which is
    // covered separately in notify.test.ts.
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(successSpy).toHaveBeenCalledTimes(1)
  })
})

describe("useDeviceFactoryReset", () => {
  it("posts {mode:'factory', confirm} and shows success toast", async () => {
    const response = {
      mode: "factory" as const,
      warning: "Device is rebooting",
    }
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response)

    const qc = makeClient()
    const { result } = renderHook(() => useDeviceFactoryReset(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ confirm: "FACTORY RESET" })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith("/api/device/reset", {
      mode: "factory",
      confirm: "FACTORY RESET",
    })
    expect(result.current.data).toEqual(response)
    expect(toast.success).toHaveBeenCalledWith(
      "Factory reset accepted — device is rebooting.",
    )
  })
})
