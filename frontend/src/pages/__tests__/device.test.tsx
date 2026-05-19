import type React from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

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

import { useNoiseSamples } from "@/features/noise/api"
import { DevicePage } from "../device"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe("DevicePage noise widget", () => {
  it("shows skeleton while loading", () => {
    ;(useNoiseSamples as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    })
    const { container } = render(wrap(<DevicePage />))
    // Skeleton uses animate-pulse class
    expect(container.querySelector(".animate-pulse")).toBeTruthy()
    expect(screen.getByText(/noise floor/i)).toBeInTheDocument()
  })

  it("shows stats when samples present", () => {
    ;(useNoiseSamples as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        { t_ms: Date.now() - 60_000, noise_floor: -120 },
        { t_ms: Date.now() - 30_000, noise_floor: -115 },
        { t_ms: Date.now(), noise_floor: -118 },
      ],
      isLoading: false,
      isError: false,
    })
    render(wrap(<DevicePage />))
    expect(screen.getAllByText(/noise floor/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/3 samples/i)).toBeInTheDocument()
    // current (last sample) is -118
    expect(screen.getByText(/-118 dBm/)).toBeInTheDocument()
    // min is -120, max is -115
    expect(screen.getByText(/-120 dBm/)).toBeInTheDocument()
    expect(screen.getByText(/-115 dBm/)).toBeInTheDocument()
  })

  it("shows error state when query errors", () => {
    ;(useNoiseSamples as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    })
    render(wrap(<DevicePage />))
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument()
  })
})
