import type React from "react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Routes, Route } from "react-router-dom"

// In jsdom the virtualizer measures 0px and renders no rows. Stub it to
// "render everything" so we can assert on DOM order.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: () => number }) => ({
    getTotalSize: () => opts.count * opts.estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        index,
        key: index,
        start: index * opts.estimateSize(),
        size: opts.estimateSize(),
      })),
  }),
}))

// Two contacts where alphabetical and most-frequent disagree, so we can
// distinguish the two sort modes purely by rendered DOM order.
// - alice: name asc => 1st; msg_count=1  => last by most_frequent
// - bob:   name asc => 2nd; msg_count=10 => first by most_frequent
vi.mock("@/features/contacts/queries", () => ({
  useContacts: () => ({
    data: {
      "alice-pk": {
        public_key: "alice-pk",
        adv_name: "alice",
        type: 1,
        flags: 0,
        last_advert: 100,
      },
      "bob-pk": {
        public_key: "bob-pk",
        adv_name: "Bob",
        type: 1,
        flags: 0,
        last_advert: 200,
      },
    },
    isLoading: false,
    isError: false,
  }),
  useContactsStats: () => ({
    data: {
      "alice-pk": {
        first_msg_at: "2026-01-01T00:00:00",
        last_msg_at: "2026-05-10T00:00:00",
        msg_count: 1,
      },
      "bob-pk": {
        first_msg_at: "2026-02-01T00:00:00",
        last_msg_at: "2026-05-15T00:00:00",
        msg_count: 10,
      },
    },
    isLoading: false,
    isError: false,
  }),
  useImportContact: () => ({ mutate: vi.fn(), isPending: false }),
  useSetFlags: () => ({ mutate: vi.fn() }),
}))

import { ContactsPage } from "../contacts"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/contacts"]}>
        <Routes>
          <Route path="/contacts" element={ui} />
          <Route path="/contact/:pubkey" element={<div>contact detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function renderedNames(): string[] {
  // Each row renders the name inside a button (the click-to-open one). Pull
  // them in document order. Filter out unrelated buttons (star, sort trigger).
  const buttons = screen.getAllByRole("button")
  const names: string[] = []
  for (const b of buttons) {
    const txt = b.textContent ?? ""
    if (txt.includes("alice") && !names.includes("alice")) names.push("alice")
    else if (txt.includes("Bob") && !names.includes("Bob")) names.push("Bob")
  }
  return names
}

describe("ContactsPage sort UI", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("defaults to 'Name' sort and renders alice before Bob", () => {
    render(wrap(<ContactsPage />))
    // The sort trigger advertises the current value.
    const trigger = screen.getByRole("combobox", { name: /sort contacts/i })
    expect(within(trigger).getByText("Name")).toBeInTheDocument()
    expect(renderedNames()).toEqual(["alice", "Bob"])
  })

  it("switching to 'Most frequent' flips the rendered order", async () => {
    render(wrap(<ContactsPage />))
    // Open the Select and pick "Most frequent".
    const trigger = screen.getByRole("combobox", { name: /sort contacts/i })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.click(trigger)
    const opt = await screen.findByRole("option", { name: /most frequent/i })
    fireEvent.click(opt)

    await waitFor(() => expect(renderedNames()).toEqual(["Bob", "alice"]))
    // And the choice was persisted.
    expect(localStorage.getItem("contacts.sort")).toBe("most_frequent")
  })
})
