import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Routes, Route } from "react-router-dom"

// Per-test contacts table the mocked `useContacts` reads from.
const contactsByPubkey: Record<string, Record<string, unknown>> = {}

vi.mock("@/features/contacts/queries", () => ({
  useContact: (pubkey: string | undefined) => ({
    contact: pubkey ? contactsByPubkey[pubkey] ?? null : null,
    isLoading: false,
  }),
  useContacts: () => ({ data: contactsByPubkey }),
  useDeleteContact: () => ({ mutate: vi.fn(), isPending: false }),
  useDiscoverPath: () => ({ mutate: vi.fn(), isPending: false }),
  usePingContact: () => ({ mutate: vi.fn(), isPending: false }),
  useRequestACL: () => ({ mutate: vi.fn(), isPending: false }),
  useRequestTelemetry: () => ({ mutate: vi.fn(), isPending: false }),
  useResetPath: () => ({ mutate: vi.fn(), isPending: false }),
  useSetFlags: () => ({ mutate: vi.fn(), isPending: false }),
  useShareContact: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock("@/features/device/queries", () => ({
  useSelfInfo: () => ({ data: undefined }),
}))

vi.mock("@/features/mutes/MuteToggle", () => ({
  MuteToggle: () => null,
}))

vi.mock("@/features/diagnostics/LinkDiagnosticPanel", () => ({
  LinkDiagnosticPanel: () => null,
}))

vi.mock("@/features/trace/monitor/TraceMonitorPanel", () => ({
  TraceMonitorPanel: () => null,
}))

import { ContactDetailPage } from "../contact-detail"

const PUBKEY =
  "a".repeat(64)

function wrap(pubkey: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/contact/${pubkey}`]}>
        <Routes>
          <Route path="/contact/:pubKey" element={<ContactDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function seedContact(pubkey: string, type: number | null | undefined) {
  contactsByPubkey[pubkey] = {
    public_key: pubkey,
    adv_name: "Test Contact",
    type,
    flags: 0,
    last_advert: 0,
    adv_lat: null,
    adv_lon: null,
  }
}

describe("ContactDetailPage Message action gating", () => {
  beforeEach(() => {
    for (const k of Object.keys(contactsByPubkey)) delete contactsByPubkey[k]
    cleanup()
  })

  it("shows the Message tile for type=1 (companion / CLI)", () => {
    seedContact(PUBKEY, 1)
    render(wrap(PUBKEY))
    expect(
      screen.getByRole("button", { name: /^message$/i }),
    ).toBeInTheDocument()
  })

  it("hides the Message tile for type=2 (repeater)", () => {
    seedContact(PUBKEY, 2)
    render(wrap(PUBKEY))
    expect(
      screen.queryByRole("button", { name: /^message$/i }),
    ).toBeNull()
  })

  it("hides the Message tile for type=3 (room server)", () => {
    seedContact(PUBKEY, 3)
    render(wrap(PUBKEY))
    expect(
      screen.queryByRole("button", { name: /^message$/i }),
    ).toBeNull()
  })

  it("hides the Message tile for type=4 (sensor)", () => {
    seedContact(PUBKEY, 4)
    render(wrap(PUBKEY))
    expect(
      screen.queryByRole("button", { name: /^message$/i }),
    ).toBeNull()
  })

  it("shows the Message tile when type is missing (safe fallback)", () => {
    seedContact(PUBKEY, undefined)
    render(wrap(PUBKEY))
    expect(
      screen.getByRole("button", { name: /^message$/i }),
    ).toBeInTheDocument()
  })
})
