import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

let channelsData: Array<{ channel_idx: number; channel_name?: string }> = []
const addMutate = vi.fn()
vi.mock("@/features/channels/queries", () => ({
  useChannels: () => ({ data: channelsData }),
  useAddChannel: () => ({ mutate: addMutate, isPending: false }),
}))

import { JoinPublicConfirm } from "../JoinPublicConfirm"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

beforeEach(() => {
  addMutate.mockReset()
  channelsData = []
})

describe("JoinPublicConfirm", () => {
  it("writes idx=0 / name=public / psk=null when slot 0 is free", async () => {
    const user = userEvent.setup()
    render(wrap(<JoinPublicConfirm onSuccess={vi.fn()} />))

    await user.click(
      screen.getByRole("button", { name: /join public channel/i }),
    )
    await waitFor(() => expect(addMutate).toHaveBeenCalled())
    expect(addMutate.mock.calls[0][0]).toEqual({
      idx: 0,
      name: "public",
      psk: null,
    })
  })

  it("requires a second click to overwrite a non-public slot 0", async () => {
    channelsData = [{ channel_idx: 0, channel_name: "Important" }]
    const user = userEvent.setup()
    render(wrap(<JoinPublicConfirm onSuccess={vi.fn()} />))

    const btn = screen.getByRole("button", { name: /overwrite slot/i })
    await user.click(btn)
    // First click only flips into "confirm" mode; no mutation yet.
    expect(addMutate).not.toHaveBeenCalled()
    expect(
      screen.getByRole("button", { name: /confirm overwrite/i }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: /confirm overwrite/i }),
    )
    await waitFor(() => expect(addMutate).toHaveBeenCalled())
  })
})
