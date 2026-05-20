import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

vi.mock("@/lib/api", () => ({
  api: { post: vi.fn() },
  isApiError: (e: unknown): boolean => e instanceof Error && "status" in e,
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { api } from "@/lib/api"
import { toast } from "sonner"
import { useLosCompute } from "../api"

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe("useLosCompute", () => {
  it("posts the LosIn body and parses the response", async () => {
    const fakeResponse = {
      distance_m: 10000.0,
      bearing_deg: 90.0,
      samples: [
        {
          distance_m: 0,
          lat: 0,
          lon: 0,
          ground_m: 0,
          bulge_m: 0,
          fresnel_m: 0,
          clearance_m: 30,
        },
        {
          distance_m: 5000,
          lat: 0,
          lon: 0.0449,
          ground_m: 0,
          bulge_m: 1.47,
          fresnel_m: 29.4,
          clearance_m: 28.5,
        },
        {
          distance_m: 10000,
          lat: 0,
          lon: 0.0898,
          ground_m: 0,
          bulge_m: 0,
          fresnel_m: 0,
          clearance_m: 30,
        },
      ],
      verdict: "CLEAR" as const,
      min_clearance_ratio: 0.97,
    }
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeResponse)

    const { result } = renderHook(() => useLosCompute(), { wrapper })
    result.current.mutate({
      a: { lat: 0, lon: 0, height_m: 30 },
      b: { lat: 0, lon: 0.0898, height_m: 30 },
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.verdict).toBe("CLEAR")
    expect(result.current.data?.distance_m).toBe(10000)
    expect(api.post).toHaveBeenCalledWith(
      "/api/los/compute",
      expect.objectContaining({ a: expect.objectContaining({ height_m: 30 }) }),
      expect.anything(),
    )
  })

  it("rejects responses that don't match the schema and surfaces a toast", async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_path, _body, schema) => {
        return schema.parse({ wrong: "shape" })
      },
    )
    const { result } = renderHook(() => useLosCompute(), { wrapper })
    result.current.mutate({
      a: { lat: 0, lon: 0, height_m: 1 },
      b: { lat: 0, lon: 0.01, height_m: 1 },
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Line-of-sight calculation"),
    )
  })
})
