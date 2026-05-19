import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { NoiseChart } from "../NoiseChart"

// uPlot relies on a real canvas implementation which JSDOM does not fully
// provide. The chart visuals are not what we want to verify here; we only need
// to assert the React shell (Card + title + children) renders correctly.
vi.mock("uplot-react", () => ({
  default: () => null,
}))

describe("NoiseChart", () => {
  it("renders inside a card with the given title", () => {
    render(
      <NoiseChart
        data={{ t: [1000, 2000, 3000], y: [-120, -119, -118] }}
        title="My Noise"
      />,
    )
    expect(screen.getByText("My Noise")).toBeInTheDocument()
  })

  it("renders without crashing with empty data", () => {
    const { container } = render(<NoiseChart data={{ t: [], y: [] }} />)
    expect(container).toBeTruthy()
  })

  it("renders with custom height + label", () => {
    render(
      <NoiseChart
        data={{ t: [1000], y: [-100] }}
        height={300}
        yLabel="Custom"
      />,
    )
    // Default title still renders when not overridden.
    expect(screen.getByText(/noise floor/i)).toBeInTheDocument()
  })
})
