import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

const mapMock = {
  setView: vi.fn(),
  getZoom: vi.fn(() => 8),
}

vi.mock("react-leaflet", () => ({
  useMap: () => mapMock,
}))

import { CenterOnSelfButton } from "../CenterOnSelfButton"

describe("CenterOnSelfButton", () => {
  beforeEach(() => {
    mapMock.setView.mockClear()
    mapMock.getZoom.mockClear()
    mapMock.getZoom.mockReturnValue(8)
  })

  it("renders disabled when self is null", () => {
    render(<CenterOnSelfButton self={null} />)
    const btn = screen.getByLabelText(/center on my node/i)
    expect(btn).toBeDisabled()
    expect(btn.getAttribute("title")).toMatch(/device location unknown/i)
    fireEvent.click(btn)
    expect(mapMock.setView).not.toHaveBeenCalled()
  })

  it("calls map.setView with self coordinates at zoom >= 14 when enabled", () => {
    render(<CenterOnSelfButton self={{ lat: 47.4979, lon: 19.0402 }} />)
    const btn = screen.getByLabelText(/center on my node/i)
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(mapMock.setView).toHaveBeenCalledTimes(1)
    const [coords, zoom] = mapMock.setView.mock.calls[0]!
    expect(coords).toEqual([47.4979, 19.0402])
    expect(zoom).toBe(14)
  })

  it("preserves a higher current zoom when centering", () => {
    mapMock.getZoom.mockReturnValue(17)
    render(<CenterOnSelfButton self={{ lat: 47.4979, lon: 19.0402 }} />)
    fireEvent.click(screen.getByLabelText(/center on my node/i))
    const [, zoom] = mapMock.setView.mock.calls[0]!
    expect(zoom).toBe(17)
  })
})
