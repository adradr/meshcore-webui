import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { MapLegend } from "../MapLegend"

const STORAGE_KEY = "meshcore.map.legend.open"

describe("MapLegend", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it("renders all five node-type chips on first mount", () => {
    render(<MapLegend />)
    // Default-open: the full panel is rendered, not just the pill.
    expect(screen.getByTestId("map-legend")).toBeInTheDocument()
    expect(screen.getByText("Me")).toBeInTheDocument()
    expect(screen.getByText("Companion")).toBeInTheDocument()
    expect(screen.getByText("Repeater")).toBeInTheDocument()
    expect(screen.getByText("Room server")).toBeInTheDocument()
    expect(screen.getByText("Unknown")).toBeInTheDocument()
    // Five swatches, one per type
    expect(screen.getByTestId("legend-swatch-SELF")).toBeInTheDocument()
    expect(screen.getByTestId("legend-swatch-CLI")).toBeInTheDocument()
    expect(screen.getByTestId("legend-swatch-REP")).toBeInTheDocument()
    expect(screen.getByTestId("legend-swatch-ROOM")).toBeInTheDocument()
    expect(screen.getByTestId("legend-swatch-UNKNOWN")).toBeInTheDocument()
  })

  it("toggling collapsed state persists to localStorage", () => {
    render(<MapLegend />)
    // Initially open — storage may or may not have been written yet.
    fireEvent.click(screen.getByTestId("map-legend-toggle"))
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("false")
    // Now collapsed: the pill is the only thing rendered, no full panel.
    expect(screen.queryByTestId("map-legend")).not.toBeInTheDocument()
    expect(screen.getByText("Legend")).toBeInTheDocument()

    // Expand again
    fireEvent.click(screen.getByTestId("map-legend-toggle"))
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true")
    expect(screen.getByTestId("map-legend")).toBeInTheDocument()
  })
})
