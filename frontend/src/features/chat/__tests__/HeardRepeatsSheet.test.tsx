import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
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
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

// Helper for the click-navigation test: renders the sheet inside a
// router that has a /contact/:pubkey route, so we can assert the
// navigation lands on the expected URL.
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname}</div>
}
function wrapWithRoutes(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/chat"]}>
        <Routes>
          <Route path="/chat" element={<>{ui}<LocationProbe /></>} />
          <Route path="/contact/:pubkey" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

// Hex-encoded repeater path: hop "ab" then "cd" (two known contacts in
// the mock above). Two hops × 1 byte each = 4 hex chars total.
const TWO_HOP_PATH = "abcd"

describe("HeardRepeatsSheet", () => {
  it("renders hops from a per-message path on a channel message", () => {
    render(
      wrap(
        <HeardRepeatsSheet
          open={true}
          onOpenChange={() => {}}
          contactPubKey={null}
          messagePath={TWO_HOP_PATH}
        />,
      ),
    )
    expect(
      screen.getByText(/path this channel message took/i),
    ).toBeInTheDocument()
    // parseRepeaterPath only resolves contacts with type=2 (repeater).
    // Our mocked Alpha/Charlie don't carry that type, so the fallback
    // "Repeater <HASH>" rendering is what we expect — proves the path
    // decoded into two hop rows, which is the load-bearing assertion.
    expect(screen.getByText("Repeater AB")).toBeInTheDocument()
    expect(screen.getByText("Repeater CD")).toBeInTheDocument()
  })


  it("shows 'no path recorded' for a channel message without a captured path", () => {
    render(
      wrap(
        <HeardRepeatsSheet
          open={true}
          onOpenChange={() => {}}
          contactPubKey={null}
        />,
      ),
    )
    // Channel messages now CAN carry a per-message path (when the radio
    // captured RX_LOG_DATA AND decrypt_channels is on). When they don't,
    // surface that honestly instead of pretending channel paths are
    // 'not applicable'.
    expect(
      screen.getByText(/no path recorded/i),
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

  it("wraps the hop list in a scrollable container so the close button stays visible on long paths", () => {
    render(
      wrap(
        <HeardRepeatsSheet
          open={true}
          onOpenChange={() => {}}
          contactPubKey={null}
          messagePath={TWO_HOP_PATH}
        />,
      ),
    )
    const scroll = screen.getByTestId("heard-repeats-scroll")
    expect(scroll.className).toMatch(/\boverflow-y-auto\b/)
    expect(scroll.className).toMatch(/\bflex-1\b/)
  })
})

describe("HeardRepeatsSheet — click-to-profile", () => {
  it("clicking a resolved repeater hop navigates to /contact/{pubkey} and closes the sheet", async () => {
    // Build a contacts mock where the hash 'ee' matches a type=2 repeater.
    const REPEATER_PK = "ee" + "11".repeat(31)
    vi.resetModules()
    vi.doMock("@/features/contacts/queries", () => ({
      useContacts: () => ({
        data: {
          [REPEATER_PK]: {
            public_key: REPEATER_PK,
            adv_name: "RelayOne",
            type: 2, // CONTACT_TYPE_REPEATER
            path: "ee",
          },
        },
      }),
      useDiscoverPath: () => ({ mutate: vi.fn(), isPending: false }),
    }))
    const { HeardRepeatsSheet: HRS } = await import("../HeardRepeatsSheet")

    const onOpenChange = vi.fn()
    render(
      wrapWithRoutes(
        <HRS
          open={true}
          onOpenChange={onOpenChange}
          contactPubKey={null}
          messagePath="ee"
        />,
      ),
    )

    const hop = await screen.findByRole("button", {
      name: /open relayone profile/i,
    })
    await userEvent.click(hop)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByTestId("location").textContent).toBe(
      `/contact/${REPEATER_PK}`,
    )

    vi.doUnmock("@/features/contacts/queries")
  })

  it("unresolved hops are rendered as inert list rows, not buttons", () => {
    // The default top-level mock has no type=2 contacts, so both hops in
    // TWO_HOP_PATH resolve as unknown repeaters and must NOT be buttons.
    render(
      wrap(
        <HeardRepeatsSheet
          open={true}
          onOpenChange={() => {}}
          contactPubKey={null}
          messagePath={TWO_HOP_PATH}
        />,
      ),
    )
    expect(screen.queryByRole("button", { name: /open .* profile/i })).toBeNull()
    // Both unresolved hop names render — just not as buttons.
    expect(screen.getByText("Repeater AB")).toBeInTheDocument()
    expect(screen.getByText("Repeater CD")).toBeInTheDocument()
  })
})
