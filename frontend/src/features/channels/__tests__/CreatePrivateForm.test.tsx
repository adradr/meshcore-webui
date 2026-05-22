import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const addMutate = vi.fn()
vi.mock("@/features/channels/queries", () => ({
  useAddChannel: () => ({ mutate: addMutate, isPending: false }),
  useNextFreeChannelIdx: () => 3,
}))

import { CreatePrivateForm } from "../CreatePrivateForm"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

beforeEach(() => addMutate.mockReset())

describe("CreatePrivateForm", () => {
  it("submits with psk=null when the secret field is blank", async () => {
    const user = userEvent.setup()
    render(wrap(<CreatePrivateForm onSuccess={vi.fn()} />))

    await user.type(screen.getByLabelText(/channel name/i), "Family")
    await user.click(screen.getByRole("button", { name: /create channel/i }))

    await waitFor(() => expect(addMutate).toHaveBeenCalled())
    const [payload] = addMutate.mock.calls[0]
    expect(payload).toEqual({ idx: 3, name: "Family", psk: null })
  })

  it("forwards an explicit 32-hex secret to the mutation", async () => {
    const user = userEvent.setup()
    render(wrap(<CreatePrivateForm onSuccess={vi.fn()} />))

    await user.type(screen.getByLabelText(/channel name/i), "Crew")
    await user.type(
      screen.getByLabelText(/secret/i),
      "8b3387e9c5cdea6ac9e5edbaa115cd72",
    )
    await user.click(screen.getByRole("button", { name: /create channel/i }))

    await waitFor(() => expect(addMutate).toHaveBeenCalled())
    expect(addMutate.mock.calls[0][0]).toEqual({
      idx: 3,
      name: "Crew",
      psk: "8b3387e9c5cdea6ac9e5edbaa115cd72",
    })
  })

  it("refuses to submit an invalid secret length", async () => {
    const user = userEvent.setup()
    render(wrap(<CreatePrivateForm onSuccess={vi.fn()} />))

    await user.type(screen.getByLabelText(/channel name/i), "Crew")
    await user.type(screen.getByLabelText(/secret/i), "0123abcd") // too short
    await user.click(screen.getByRole("button", { name: /create channel/i }))

    expect(addMutate).not.toHaveBeenCalled()
    expect(
      screen.getByText(/must be exactly 32 hex characters/i),
    ).toBeInTheDocument()
  })
})
