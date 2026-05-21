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
import {
  useLocalReset,
  useDeviceSoftReset,
  useDeviceFactoryReset,
} from "../api"

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

describe("useLocalReset", () => {
  it("posts {scope, confirm} and parses response", async () => {
    const response = { scope: "messages" as const, deleted_rows: 5 }
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response)

    const qc = makeClient()
    const { result } = renderHook(() => useLocalReset(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ scope: "messages", confirm: "Clear chat history" })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith("/api/admin/reset/local", {
      scope: "messages",
      confirm: "Clear chat history",
    })
    expect(result.current.data).toEqual(response)
  })
})

describe("useDeviceSoftReset", () => {
  it("posts {mode:'soft', confirm} and parses response", async () => {
    const response = { mode: "soft" as const, cleared_channels: 3 }
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response)

    const qc = makeClient()
    const { result } = renderHook(() => useDeviceSoftReset(), {
      wrapper: makeWrapper(qc),
    })
    result.current.mutate({ confirm: "RESET" })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.post).toHaveBeenCalledWith("/api/device/reset", {
      mode: "soft",
      confirm: "RESET",
    })
    expect(result.current.data).toEqual(response)
  })
})

describe("useDeviceFactoryReset", () => {
  it("posts {mode:'factory', confirm} and parses response", async () => {
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
  })
})
