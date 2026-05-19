import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { HeardRepeatsSheet } from "../HeardRepeatsSheet"

const mockDiscoverMutate = vi.fn()

vi.mock("@/features/contacts/queries", () => ({
  useContacts: () => ({
    data: {
      ["ab" + "00".repeat(31)]: {
        public_key: "ab" + "00".repeat(31),
        adv_name: "Alpha",
        path: null, // unknown
      },
      ["cd" + "00".repeat(31)]: {
        public_key: "cd" + "00".repeat(31),
        adv_name: "Charlie",
        path: "", // explicit direct/empty
      },
    },
  }),
  useDiscoverPath: () => ({ mutate: mockDiscoverMutate, isPending: false }),
}))

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

describe("HeardRepeatsSheet", () => {
  it("shows channel-friendly text when contactPubKey is null", () => {
    render(
      wrap(
        <HeardRepeatsSheet
          open={true}
          onOpenChange={() => {}}
          contactPubKey={null}
        />,
      ),
    )
    expect(
      screen.getByText(/repeater path varies per relay/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/not applicable for channel messages/i),
    ).toBeInTheDocument()
  })

  it("shows Contact not found when no matching contact", () => {
    render(
      wrap(
        <HeardRepeatsSheet
          open={true}
          onOpenChange={() => {}}
          contactPubKey="ff"
        />,
      ),
    )
    expect(
      screen.getByText(/contact not found in the local list/i),
    ).toBeInTheDocument()
  })

  it("shows Discover path button when contact path is unknown (null)", () => {
    render(
      wrap(
        <HeardRepeatsSheet
          open={true}
          onOpenChange={() => {}}
          contactPubKey="ab"
        />,
      ),
    )
    expect(screen.getByText(/no path discovered/i)).toBeInTheDocument()
    const btn = screen.getByRole("button", { name: /discover path/i })
    expect(btn).toBeInTheDocument()
    btn.click()
    expect(mockDiscoverMutate).toHaveBeenCalledWith({
      pubkey: "ab" + "00".repeat(31),
    })
  })

  it("shows Direct text when path is explicitly empty (direct)", () => {
    render(
      wrap(
        <HeardRepeatsSheet
          open={true}
          onOpenChange={() => {}}
          contactPubKey="cd"
        />,
      ),
    )
    expect(
      screen.getByText(/direct \(no repeaters in path\)/i),
    ).toBeInTheDocument()
  })
})
