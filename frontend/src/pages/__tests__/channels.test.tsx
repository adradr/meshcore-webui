import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

const addMutate = vi.fn((_payload: unknown, opts?: { onSuccess?: () => void }) => {
  opts?.onSuccess?.()
})
vi.mock("@/features/channels/queries", () => ({
  useChannels: () => ({ data: [], isLoading: false, isError: false }),
  useAddChannel: () => ({ mutate: addMutate, isPending: false }),
  useRemoveChannel: () => ({ mutate: vi.fn(), isPending: false }),
  useNextFreeChannelIdx: () => 1,
  useMaxChannels: () => 16,
}))

// Camera isn't relevant for the page-level integration test.
vi.mock("@yudiel/react-qr-scanner", () => ({
  Scanner: () => <div data-testid="mock-scanner" />,
}))

// Stub the mute hook so we don't hit the auth store.
vi.mock("@/features/mutes/MuteToggle", () => ({
  MuteToggle: () => null,
}))

import { ChannelsPage } from "../channels"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => addMutate.mockReset())

describe("ChannelsPage — Add Channel sheet integration", () => {
  it("flows from + button through Join Hashtag to a successful write", async () => {
    const user = userEvent.setup()
    render(wrap(<ChannelsPage />))

    await user.click(screen.getByRole("button", { name: /add channel/i }))
    await user.click(
      screen.getByRole("button", { name: /join a hashtag channel/i }),
    )

    const input = screen.getByPlaceholderText("#example")
    await user.type(input, "weather")
    await user.click(screen.getByRole("button", { name: /join hashtag/i }))

    await waitFor(() => expect(addMutate).toHaveBeenCalled())
    expect(addMutate.mock.calls[0][0]).toEqual({
      idx: 1,
      name: "#weather",
      psk: null,
    })
  })
})
