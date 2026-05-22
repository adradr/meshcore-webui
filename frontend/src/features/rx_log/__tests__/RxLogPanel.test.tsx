import type React from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { WebSocketContext } from "@/realtime/WebSocketProvider"
import {
  RxLogPanel,
  formatRecvClock,
  relativeTime,
  deriveOptions,
} from "../RxLogPanel"
import type { RxEntry } from "@/features/rx_log/api"

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

// Unix seconds: 2024-01-01T00:00:00Z is 1704067200
const T1 = 1704067200
const T2 = 1704067260

const seed: RxEntry[] = [
  {
    recv_time: T1,
    snr: 1.5,
    rssi: -90,
    payload_length: 5,
    route_typename: "FLOOD",
    payload_typename: "TXT_PLAIN",
    pkt_hash: "aabbccdd",
    path: "",
    raw_hex: "00 01 02 03 04",
  },
  {
    recv_time: T2,
    snr: 2.5,
    rssi: -85,
    payload_length: 7,
    route_typename: "DIRECT",
    payload_typename: "ACK",
    pkt_hash: "eeff1122",
    path: "",
    raw_hex: "10 11 12",
  },
]

describe("RxLogPanel", () => {
  it("renders rows from REST seed", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: seed,
      total_buffered: 2,
      returned: 2,
    })
    render(wrap(<RxLogPanel />))
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
    render(wrap(<RxLogPanel />))
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
    render(wrap(<RxLogPanel />))
    await waitFor(() =>
      expect(screen.getByText(/no rx events yet/i)).toBeInTheDocument(),
    )
  })

  it("renders Time column as HH:MM:SS for valid recv_time", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: seed,
      total_buffered: 2,
      returned: 2,
    })
    render(wrap(<RxLogPanel />))
    await waitFor(() =>
      expect(screen.getByText(/aabbccdd/)).toBeInTheDocument(),
    )
    // Expect the format HH:MM:SS to show up at least twice (one per row).
    const clockMatches = screen.getAllByText(/^\d{2}:\d{2}:\d{2}$/)
    expect(clockMatches.length).toBeGreaterThanOrEqual(2)
  })

  it("renders Time column as em-dash when recv_time is missing", async () => {
    const rowsMissing: RxEntry[] = [
      {
        recv_time: null,
        snr: null,
        rssi: null,
        payload_length: 0,
        route_typename: "FLOOD",
        payload_typename: "TXT_PLAIN",
        pkt_hash: "deadbeef",
        path: "",
        raw_hex: "",
      },
    ]
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: rowsMissing,
      total_buffered: 1,
      returned: 1,
    })
    render(wrap(<RxLogPanel />))
    await waitFor(() =>
      expect(screen.getByText(/deadbeef/)).toBeInTheDocument(),
    )
    const row = screen.getByText(/deadbeef/).closest("tr")!
    // First TableCell of the row is the Time cell.
    const timeCell = row.querySelectorAll("td")[0]
    expect(timeCell.textContent).toContain("—")
  })

  it("Route filter lists only observed route_typename values", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: seed,
      total_buffered: 2,
      returned: 2,
    })
    render(wrap(<RxLogPanel />))
    await waitFor(() =>
      expect(screen.getByText(/aabbccdd/)).toBeInTheDocument(),
    )
    // Open the Route Select to expose its options.
    fireEvent.click(screen.getByLabelText(/route type filter/i))
    const flood = await screen.findByRole("option", { name: /FLOOD \(1\)/ })
    const direct = await screen.findByRole("option", { name: /DIRECT \(1\)/ })
    expect(flood).toBeInTheDocument()
    expect(direct).toBeInTheDocument()
    // None of the legacy hardcoded numeric options should appear.
    expect(
      screen.queryByRole("option", { name: /^Route 0$/ }),
    ).toBeNull()
    expect(
      screen.queryByRole("option", { name: /^Route 1$/ }),
    ).toBeNull()
  })

  it("filters rows by route_typename when a route option is picked", async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: seed,
      total_buffered: 2,
      returned: 2,
    })
    render(wrap(<RxLogPanel />))
    await waitFor(() =>
      expect(screen.getByText(/aabbccdd/)).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByLabelText(/route type filter/i))
    const direct = await screen.findByRole("option", { name: /DIRECT \(1\)/ })
    fireEvent.click(direct)
    await waitFor(() => expect(screen.queryByText(/aabbccdd/)).toBeNull())
    expect(screen.getByText(/eeff1122/)).toBeInTheDocument()
  })
})

describe("formatRecvClock", () => {
  it("returns em-dash for null/undefined/zero", () => {
    expect(formatRecvClock(null)).toBe("—")
    expect(formatRecvClock(undefined)).toBe("—")
    expect(formatRecvClock(0)).toBe("—")
  })

  it("formats unix seconds as HH:MM:SS", () => {
    const out = formatRecvClock(T1)
    expect(out).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })
})

// 2027-01-15 UTC — fixed reference time inside the plausibility window
// for advert / last-heard timestamps (post-2020, not future-dated).
const NOW_MS = 1_800_000_000_000

describe("relativeTime", () => {
  it("returns em-dash for missing time", () => {
    expect(relativeTime(null)).toBe("—")
    expect(relativeTime(undefined)).toBe("—")
    expect(relativeTime(0)).toBe("—")
  })

  it('returns "now" for diffs under one second', () => {
    expect(relativeTime(NOW_MS / 1000, NOW_MS)).toBe("now")
  })

  it("returns seconds for sub-minute diffs", () => {
    expect(relativeTime(NOW_MS / 1000 - 12, NOW_MS)).toBe("12s ago")
  })

  it("returns minutes for sub-hour diffs", () => {
    expect(relativeTime(NOW_MS / 1000 - 90, NOW_MS)).toBe("1m 30s ago")
    expect(relativeTime(NOW_MS / 1000 - 120, NOW_MS)).toBe("2m ago")
  })

  it("returns hours for sub-day diffs", () => {
    expect(relativeTime(NOW_MS / 1000 - 3700, NOW_MS)).toBe("1h 1m ago")
    expect(relativeTime(NOW_MS / 1000 - 7200, NOW_MS)).toBe("2h ago")
  })

  it("returns days for big diffs", () => {
    expect(relativeTime(NOW_MS / 1000 - 86400 * 3, NOW_MS)).toBe("3d ago")
  })
})

describe("deriveOptions", () => {
  it("returns empty array for empty input", () => {
    expect(deriveOptions([], "route_typename")).toEqual([])
  })

  it("counts and sorts observed typename values", () => {
    const entries: RxEntry[] = [
      { route_typename: "DIRECT", payload_typename: "ACK" },
      { route_typename: "FLOOD", payload_typename: "TXT_PLAIN" },
      { route_typename: "DIRECT", payload_typename: "ACK" },
    ]
    const opts = deriveOptions(entries, "route_typename")
    expect(opts).toEqual([
      { value: "DIRECT", label: "DIRECT (2)", count: 2 },
      { value: "FLOOD", label: "FLOOD (1)", count: 1 },
    ])
  })

  it("ignores null/undefined/empty typename values", () => {
    const entries: RxEntry[] = [
      { route_typename: null },
      { route_typename: undefined },
      { route_typename: "" },
      { route_typename: "FLOOD" },
    ]
    expect(deriveOptions(entries, "route_typename")).toEqual([
      { value: "FLOOD", label: "FLOOD (1)", count: 1 },
    ])
  })
})
