import type React from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Routes, Route } from "react-router-dom"

// Mock device queries so the page renders without network/WS.
vi.mock("@/features/device/queries", () => ({
  useDeviceInfo: () => ({
    data: {
      model: "T3-S3",
      ver: "1.7.0",
      fw_build: "20260101",
      max_contacts: 100,
      max_channels: 8,
      ble_pin: 0,
      repeat: false,
    },
    isLoading: false,
    isError: false,
  }),
  useSelfInfo: () => ({
    data: {
      name: "Test Device",
      public_key: "abcdef0123456789abcdef0123456789",
      adv_lat: 47.5,
      adv_lon: 19.05,
      radio_freq: 869.525,
      radio_bw: 250,
      radio_sf: 11,
      radio_cr: 5,
      tx_power: 22,
      max_tx_power: 22,
    },
    isLoading: false,
    isError: false,
  }),
  useSendAdvert: () => ({ mutate: vi.fn(), isPending: false }),
  useDeviceStatus: () => ({
    data: { connected: true, host: "192.168.4.1", port: 5000 },
    isLoading: false,
    isError: false,
  }),
}))

vi.mock("@/realtime/WebSocketProvider", async () => {
  const actual = await vi.importActual<
    typeof import("@/realtime/WebSocketProvider")
  >("@/realtime/WebSocketProvider")
  return {
    ...actual,
    useRealtime: () => ({
      status: "open",
      subscribe: () => () => {},
    }),
  }
})

vi.mock("@/features/noise/api", () => ({
  useNoiseSamples: vi.fn(),
}))

// Avoid uPlot DOM work in jsdom.
vi.mock("uplot-react", () => ({ default: () => null }))

// Mock the lower-level api so RxLogPanel (mounted via Tabs forceMount) does
// not try to hit a real endpoint.
vi.mock("@/lib/api", () => ({ api: { get: vi.fn().mockResolvedValue({
  items: [],
  total_buffered: 0,
  returned: 0,
}) } }))

import { useNoiseSamples } from "@/features/noise/api"
import { DevicePage } from "../device"

function wrap(ui: React.ReactNode, initialPath = "/device") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/device" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("DevicePage tabs", () => {
  it("renders the three primary tab triggers", () => {
    ;(useNoiseSamples as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    })
    render(wrap(<DevicePage />))
    expect(screen.getByRole("tab", { name: /^info$/i })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /rx log/i })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /^noise$/i })).toBeInTheDocument()
  })

  it("defaults to the Info tab when no ?tab query param is set", () => {
    ;(useNoiseSamples as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    })
    render(wrap(<DevicePage />))
    const infoTab = screen.getByRole("tab", { name: /^info$/i })
    expect(infoTab).toHaveAttribute("aria-selected", "true")
    // Info content (collapsed Device card) is visible. Assert on the mocked
    // device name rather than a section title — that survives further UI
    // restructures.
    expect(screen.getByText("Test Device")).toBeInTheDocument()
  })

  it("clicking the RX Log tab reveals the rx-log content", async () => {
    ;(useNoiseSamples as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    })
    render(wrap(<DevicePage />))
    const rxTab = screen.getByRole("tab", { name: /rx log/i })
    // Radix Tabs triggers selection on pointerdown / mousedown for snappier
    // touch behaviour; fireEvent.click alone does not flip the active tab.
    fireEvent.mouseDown(rxTab)
    fireEvent.click(rxTab)
    await waitFor(() =>
      expect(rxTab).toHaveAttribute("aria-selected", "true"),
    )
    // The RxToolbar exposes a search input — confirms RxLogPanel rendered
    // its body, not just the trigger label.
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it("?tab=rx-log deep links straight into the RX Log tab", () => {
    ;(useNoiseSamples as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    })
    render(wrap(<DevicePage />, "/device?tab=rx-log"))
    expect(screen.getByRole("tab", { name: /rx log/i })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })

  it("?tab=noise deep links straight into the Noise tab", () => {
    ;(useNoiseSamples as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    })
    render(wrap(<DevicePage />, "/device?tab=noise"))
    expect(screen.getByRole("tab", { name: /^noise$/i })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })

  it("ignores unknown ?tab values and falls back to Info", () => {
    ;(useNoiseSamples as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    })
    render(wrap(<DevicePage />, "/device?tab=bogus"))
    expect(screen.getByRole("tab", { name: /^info$/i })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })
})
