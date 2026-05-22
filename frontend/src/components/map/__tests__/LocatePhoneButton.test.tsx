import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { toast } from "sonner"

const mapMock = {
  setView: vi.fn(),
  getZoom: vi.fn(() => 8),
}

vi.mock("react-leaflet", () => ({
  useMap: () => mapMock,
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { LocatePhoneButton } from "../LocatePhoneButton"

type SuccessCb = (pos: { coords: { latitude: number; longitude: number } }) => void
type ErrorCb = (err: { message: string }) => void

describe("LocatePhoneButton", () => {
  const originalGeo = navigator.geolocation

  beforeEach(() => {
    mapMock.setView.mockClear()
    mapMock.getZoom.mockClear()
    mapMock.getZoom.mockReturnValue(8)
    vi.mocked(toast.error).mockClear()
  })

  afterEach(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: originalGeo,
      configurable: true,
    })
  })

  function installGeolocation(
    impl: (success: SuccessCb, error: ErrorCb) => void,
  ) {
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: impl },
      configurable: true,
    })
  }

  it("pans the map to the phone position on geolocation success", () => {
    installGeolocation((success) =>
      success({ coords: { latitude: 47.5, longitude: 19.05 } }),
    )
    render(<LocatePhoneButton />)
    fireEvent.click(screen.getByLabelText(/locate my phone/i))
    expect(mapMock.setView).toHaveBeenCalledTimes(1)
    const [coords, zoom] = mapMock.setView.mock.calls[0]!
    expect(coords).toEqual([47.5, 19.05])
    expect(zoom).toBe(14)
  })

  it("preserves a higher current zoom when locating", () => {
    mapMock.getZoom.mockReturnValue(18)
    installGeolocation((success) =>
      success({ coords: { latitude: 1, longitude: 2 } }),
    )
    render(<LocatePhoneButton />)
    fireEvent.click(screen.getByLabelText(/locate my phone/i))
    const [, zoom] = mapMock.setView.mock.calls[0]!
    expect(zoom).toBe(18)
  })

  it("shows an error toast with the geolocation message on failure", () => {
    installGeolocation((_success, error) => error({ message: "denied" }))
    render(<LocatePhoneButton />)
    fireEvent.click(screen.getByLabelText(/locate my phone/i))
    expect(mapMock.setView).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.error).mock.calls[0]![0]).toMatch(/denied/i)
  })

  it("shows an error toast when the browser doesn't support geolocation", () => {
    Object.defineProperty(navigator, "geolocation", {
      value: undefined,
      configurable: true,
    })
    render(<LocatePhoneButton />)
    fireEvent.click(screen.getByLabelText(/locate my phone/i))
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.error).mock.calls[0]![0]).toMatch(/geolocation/i)
  })
})
