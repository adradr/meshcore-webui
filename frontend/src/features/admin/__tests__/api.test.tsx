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
      },
      device: {
        cleared_channels: 2,
        coords_reset: true,
        removed_contacts: null,
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
