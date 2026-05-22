import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const addMutate = vi.fn()
vi.mock("@/features/channels/queries", () => ({
  useAddChannel: () => ({ mutate: addMutate, isPending: false }),
  useNextFreeChannelIdx: () => 4,
}))

import { JoinHashtagForm } from "../JoinHashtagForm"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

beforeEach(() => addMutate.mockReset())

describe("JoinHashtagForm", () => {
  it("submits with psk=null and a leading #", async () => {
    const user = userEvent.setup()
    render(wrap(<JoinHashtagForm onSuccess={vi.fn()} />))

    const input = screen.getByLabelText(/hashtag/i) as HTMLInputElement
    // Initial value is "#" — append the tag.
    await user.type(input, "weather")
    await user.click(screen.getByRole("button", { name: /join hashtag/i }))

    await waitFor(() => expect(addMutate).toHaveBeenCalled())
    expect(addMutate.mock.calls[0][0]).toEqual({
      idx: 4,
      name: "#weather",
      psk: null,
    })
  })

  it("rejects invalid characters", async () => {
    const user = userEvent.setup()
    render(wrap(<JoinHashtagForm onSuccess={vi.fn()} />))

    const input = screen.getByLabelText(/hashtag/i) as HTMLInputElement
    // Use fireEvent through userEvent — clear and type a value with a space.
    await user.clear(input)
    await user.type(input, "#has space")
    expect(
      screen.getByText(/letters, digits or underscores/i),
    ).toBeInTheDocument()
    const btn = screen.getByRole("button", {
      name: /join hashtag/i,
    }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})
