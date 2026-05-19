import type React from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { WebSocketContext } from "@/realtime/WebSocketProvider"
import { RxLogPage } from "../rx-log"

vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }))
import { api } from "@/lib/api"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const subs = new Map<string, Set<(p: unknown) => void>>()
  const subscribe = (topic: string, h: (p: unknown) => void) => {
    if (!subs.has(topic)) subs.set(topic, new Set())
    subs.get(topic)!.add(h)
    return () => {
      subs.get(topic)!.delete(h)
    }
  }
  const ctxValue = { subscribe, status: "open" } as unknown as React.ContextType<
    typeof WebSocketContext
  >
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WebSocketContext.Provider value={ctxValue}>
          {ui}
        </WebSocketContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const seed = [
  {
    recv_time: 100,
    snr: 1.5,
    rssi: -90,
    payload_length: 5,
    route_typename: "F",
    payload_typename: "TXT_PLAIN",
    pkt_hash: "aabbccdd",
    path: "",
    raw_hex: "00 01 02 03 04",
  },
  {
    recv_time: 200,
    snr: 2.5,
    rssi: -85,
    payload_length: 7,
    route_typename: "D",
    payload_typename: "ACK",
    pkt_hash: "eeff1122",
    path: "",
    raw_hex: "10 11 12",
  },
]

describe("RxLogPage", () => {
  it("renders rows from REST seed", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: seed,
      total_buffered: 2,
      returned: 2,
    })
    render(wrap(<RxLogPage />))
    await waitFor(() =>
      expect(screen.getByText(/aabbccdd/)).toBeInTheDocument(),
    )
    expect(screen.getByText(/eeff1122/)).toBeInTheDocument()
  })

  it("filters rows by search input", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: seed,
      total_buffered: 2,
      returned: 2,
    })
    render(wrap(<RxLogPage />))
    await waitFor(() =>
      expect(screen.getByText(/aabbccdd/)).toBeInTheDocument(),
    )
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: "eeff" },
    })
    await waitFor(() => expect(screen.queryByText(/aabbccdd/)).toBeNull())
    expect(screen.getByText(/eeff1122/)).toBeInTheDocument()
  })

  it("shows empty state when no rows", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [],
      total_buffered: 0,
      returned: 0,
    })
    render(wrap(<RxLogPage />))
    await waitFor(() =>
      expect(screen.getByText(/no rx events yet/i)).toBeInTheDocument(),
    )
  })
})
