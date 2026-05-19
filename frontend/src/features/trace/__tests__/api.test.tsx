import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

vi.mock("@/lib/api", () => ({
  api: { post: vi.fn() },
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { api } from "@/lib/api"
import { toast } from "sonner"
import { useTracePath } from "../api"

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe("useTracePath", () => {
  it("posts to /api/trace/{pubkey} and parses the TraceOut response", async () => {
    const pubkey = "ab".repeat(32)
    const fakeOut = {
      requested_target_pubkey: pubkey,
      tag: 42,
      flags: 0,
      path_len: 2,
      hops: [
        {
          hash: "ab",
          snr: 3.5,
          name: "A",
          pub_key: pubkey,
          lat: 1,
          lon: 2,
          candidates: [],
        },
        {
          hash: "cd",
          snr: 4.0,
          name: null,
          pub_key: null,
          lat: null,
          lon: null,
          candidates: [],
        },
      ],
    }
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeOut)

    const { result } = renderHook(() => useTracePath(), { wrapper })
    result.current.mutate(pubkey)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.tag).toBe(42)
    expect(result.current.data?.hops[0].name).toBe("A")
    expect(api.post).toHaveBeenCalledWith(
      `/api/trace/${pubkey}`,
      {},
      expect.anything(),
    )
  })

  it("rejects malformed response", async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_path, _body, schema) => {
        return schema.parse({ wrong: "shape" })
      },
    )
    const { result } = renderHook(() => useTracePath(), { wrapper })
    result.current.mutate("aa".repeat(32))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Trace failed"),
    )
  })
})
