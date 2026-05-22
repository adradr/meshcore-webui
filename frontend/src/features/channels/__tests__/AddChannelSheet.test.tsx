import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// Stub data hooks so the sheet renders without any backend.
const addMutate = vi.fn()
vi.mock("@/features/channels/queries", () => ({
  useChannels: () => ({ data: [] }),
  useAddChannel: () => ({ mutate: addMutate, isPending: false }),
  useNextFreeChannelIdx: () => 1,
  useMaxChannels: () => 16,
}))

// Inert scanner so jsdom doesn't try to open a camera.
vi.mock("@yudiel/react-qr-scanner", () => ({
  Scanner: () => <div data-testid="mock-scanner" />,
}))

import { AddChannelSheet } from "../AddChannelSheet"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

beforeEach(() => {
  addMutate.mockReset()
})

describe("AddChannelSheet", () => {
  it("opens the bottom sheet and shows the five option cards", async () => {
    const user = userEvent.setup()
    render(wrap(<AddChannelSheet />))
    await user.click(screen.getByRole("button", { name: /add channel/i }))

    expect(screen.getByText(/create a private channel/i)).toBeInTheDocument()
    expect(screen.getByText(/join a private channel/i)).toBeInTheDocument()
    expect(screen.getByText(/join the public channel/i)).toBeInTheDocument()
    expect(screen.getByText(/join a hashtag channel/i)).toBeInTheDocument()
    expect(screen.getByText(/scan qr code/i)).toBeInTheDocument()
  })

  it("navigates into a sub-flow and back via the back button", async () => {
    const user = userEvent.setup()
    render(wrap(<AddChannelSheet />))
    await user.click(screen.getByRole("button", { name: /add channel/i }))

    await user.click(
      screen.getByRole("button", { name: /join a hashtag channel/i }),
    )
    // The hashtag form is now mounted (the `#example` placeholder is unique
    // to the form input — using it sidesteps the "Hashtag" title appearing
    // both in the SheetTitle and as the input label).
    expect(screen.getByPlaceholderText("#example")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /back to options/i }))
    // Option grid is back.
    expect(screen.getByText(/create a private channel/i)).toBeInTheDocument()
  })
})
