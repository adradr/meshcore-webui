import type React from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

vi.mock("@/features/noise/api", () => ({ useNoiseSamples: vi.fn() }))
vi.mock("uplot-react", () => ({ default: () => null }))

import { useNoiseSamples } from "@/features/noise/api"
import { NoisePage } from "../noise"

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe("NoisePage", () => {
  it("computes stats from samples", () => {
    ;(useNoiseSamples as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        { t_ms: 1000, noise_floor: -120 },
        { t_ms: 2000, noise_floor: -110 },
        { t_ms: 3000, noise_floor: -115 },
      ],
      isLoading: false,
      isError: false,
    })
    render(wrap(<NoisePage />))
    // Current = last = -115
    expect(screen.getByText(/-115 dBm/)).toBeInTheDocument()
    // Min = -120, Max = -110
    expect(screen.getByText("-120 dBm")).toBeInTheDocument()
    expect(screen.getByText("-110 dBm")).toBeInTheDocument()
    // Samples count
    expect(screen.getByText(/3 samples/i)).toBeInTheDocument()
  })

  it("renders dash placeholders when no samples", () => {
    ;(useNoiseSamples as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    })
    render(wrap(<NoisePage />))
    const dashes = screen.getAllByText("—")
    expect(dashes.length).toBeGreaterThanOrEqual(4) // current, min, max, mean
  })

  it("toggles paused state via Switch", () => {
    ;(useNoiseSamples as ReturnType<typeof vi.fn>).mockImplementation(
      (opts: { paused?: boolean } | undefined) => ({
        data: [],
        isLoading: false,
        isError: false,
        _paused: opts?.paused,
      }),
    )
    render(wrap(<NoisePage />))
    const sw = screen.getByLabelText(/pause stream/i)
    expect(sw).not.toBeChecked()
    fireEvent.click(sw)
    expect(sw).toBeChecked()
  })
})
