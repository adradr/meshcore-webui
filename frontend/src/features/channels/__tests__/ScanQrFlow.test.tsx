import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const addMutate = vi.fn()
vi.mock("@/features/channels/queries", () => ({
  useAddChannel: () => ({ mutate: addMutate, isPending: false }),
  useNextFreeChannelIdx: () => 2,
}))

// Mock the QR scanner to expose a button that simulates a successful
// detection of a meshcore://channel/add URI.
vi.mock("@yudiel/react-qr-scanner", () => ({
  Scanner: ({
    onScan,
  }: {
    onScan: (codes: Array<{ rawValue: string }>) => void
  }) => (
    <button
      type="button"
      onClick={() =>
        onScan([
          {
            rawValue:
              "meshcore://channel/add?name=Public&secret=8b3387e9c5cdea6ac9e5edbaa115cd72",
          },
        ])
      }
    >
      mock-scan
    </button>
  ),
}))

import { ScanQrFlow } from "../ScanQrFlow"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

beforeEach(() => addMutate.mockReset())

describe("ScanQrFlow", () => {
  it("decodes a scanned URI and pre-fills the join form", async () => {
    const user = userEvent.setup()
    render(wrap(<ScanQrFlow onSuccess={vi.fn()} />))

    await user.click(screen.getByRole("button", { name: /mock-scan/i }))

    await waitFor(() => {
      expect(
        (screen.getByLabelText(/channel name/i) as HTMLInputElement).value,
      ).toBe("Public")
    })
    expect((screen.getByLabelText(/secret/i) as HTMLInputElement).value).toBe(
      "8b3387e9c5cdea6ac9e5edbaa115cd72",
    )
  })

  it("accepts a manually pasted URL via the fallback input", async () => {
    const user = userEvent.setup()
    render(wrap(<ScanQrFlow onSuccess={vi.fn()} />))

    await user.type(
      screen.getByLabelText(/paste the link/i),
      "meshcore://channel/add?name=Crew&secret=ffffffffffffffffffffffffffffffff",
    )
    await user.click(screen.getByRole("button", { name: /use link/i }))

    await waitFor(() => {
      expect(
        (screen.getByLabelText(/channel name/i) as HTMLInputElement).value,
      ).toBe("Crew")
    })
  })

  it("ignores non-MeshCore URIs", async () => {
    const user = userEvent.setup()
    render(wrap(<ScanQrFlow onSuccess={vi.fn()} />))

    await user.type(
      screen.getByLabelText(/paste the link/i),
      "https://example.com/foo",
    )
    await user.click(screen.getByRole("button", { name: /use link/i }))

    // No JoinPrivateForm should appear.
    expect(screen.queryByLabelText(/channel name/i)).toBeNull()
  })
})
