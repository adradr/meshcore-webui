import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const addMutate = vi.fn()
vi.mock("@/features/channels/queries", () => ({
  useAddChannel: () => ({ mutate: addMutate, isPending: false }),
  useNextFreeChannelIdx: () => 5,
}))

import { JoinPrivateForm } from "../JoinPrivateForm"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

beforeEach(() => addMutate.mockReset())

describe("JoinPrivateForm", () => {
  it("rejects a non-hex secret with an inline error", async () => {
    const user = userEvent.setup()
    render(wrap(<JoinPrivateForm onSuccess={vi.fn()} />))

    await user.type(screen.getByLabelText(/channel name/i), "Secret")
    await user.type(
      screen.getByLabelText(/secret/i),
      "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ", // 32 chars but non-hex
    )
    await user.click(screen.getByRole("button", { name: /join channel/i }))

    expect(addMutate).not.toHaveBeenCalled()
    expect(
      screen.getByText(/must be exactly 32 hex characters/i),
    ).toBeInTheDocument()
  })

  it("submits a valid 32-hex secret using the next free slot", async () => {
    const user = userEvent.setup()
    render(wrap(<JoinPrivateForm onSuccess={vi.fn()} />))

    await user.type(screen.getByLabelText(/channel name/i), "Crew")
    await user.type(
      screen.getByLabelText(/secret/i),
      "8B3387E9C5CDEA6AC9E5EDBAA115CD72", // uppercase to verify lowercasing
    )
    await user.click(screen.getByRole("button", { name: /join channel/i }))

    await waitFor(() => expect(addMutate).toHaveBeenCalled())
    expect(addMutate.mock.calls[0][0]).toEqual({
      idx: 5,
      name: "Crew",
      psk: "8b3387e9c5cdea6ac9e5edbaa115cd72",
    })
  })

  it("pre-fills from the QR scan payload", () => {
    render(
      wrap(
        <JoinPrivateForm
          prefill={{
            name: "Public",
            secret: "8b3387e9c5cdea6ac9e5edbaa115cd72",
          }}
          onSuccess={vi.fn()}
        />,
      ),
    )

    expect(
      (screen.getByLabelText(/channel name/i) as HTMLInputElement).value,
    ).toBe("Public")
    expect((screen.getByLabelText(/secret/i) as HTMLInputElement).value).toBe(
      "8b3387e9c5cdea6ac9e5edbaa115cd72",
    )
  })
})
