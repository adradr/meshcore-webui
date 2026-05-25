import { describe, expect, it, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { ThemedTileLayer } from "../TileLayers"
import {
  DEFAULT_TILE_ATTRIBUTION_DARK,
  DEFAULT_TILE_ATTRIBUTION_LIGHT,
  DEFAULT_TILE_URL_DARK,
  DEFAULT_TILE_URL_LIGHT,
  type AuthInfo,
} from "@/features/auth/types"

// Capture the props react-leaflet receives so we can assert that the
// runtime override (or default fallback) actually flows through.
const tileCalls: Record<string, unknown>[] = []
vi.mock("react-leaflet", () => ({
  TileLayer: (props: Record<string, unknown>) => {
    tileCalls.push(props)
    return null
  },
}))

// `useAuthInfo()` is the single source of truth — stub it per-test so we
// can drive the {data} value without spinning up TanStack Query.
const authMock = vi.fn<() => { data: AuthInfo | undefined }>(() => ({
  data: undefined,
}))
vi.mock("@/features/auth/api", () => ({
  useAuthInfo: () => authMock(),
}))

describe("ThemedTileLayer", () => {
  beforeEach(() => {
    tileCalls.length = 0
    authMock.mockReset()
  })

  it("falls back to public OSM defaults when auth info hasn't resolved yet", () => {
    authMock.mockReturnValue({ data: undefined })
    render(<ThemedTileLayer dark={false} />)
    expect(tileCalls).toHaveLength(1)
    expect(tileCalls[0].url).toBe(DEFAULT_TILE_URL_LIGHT)
    expect(tileCalls[0].attribution).toBe(DEFAULT_TILE_ATTRIBUTION_LIGHT)
  })

  it("uses CARTO defaults in dark mode when nothing is overridden", () => {
    authMock.mockReturnValue({
      data: {
        required: false,
        valid: true,
      },
    })
    render(<ThemedTileLayer dark />)
    expect(tileCalls[0].url).toBe(DEFAULT_TILE_URL_DARK)
    expect(tileCalls[0].attribution).toBe(DEFAULT_TILE_ATTRIBUTION_DARK)
  })

  it("renders the operator-supplied light tile URL + attribution", () => {
    authMock.mockReturnValue({
      data: {
        required: false,
        valid: true,
        tile_url_light: "https://tiles.internal/{z}/{x}/{y}.png",
        tile_attribution_light: "&copy; internal",
      },
    })
    render(<ThemedTileLayer dark={false} />)
    expect(tileCalls[0].url).toBe("https://tiles.internal/{z}/{x}/{y}.png")
    expect(tileCalls[0].attribution).toBe("&copy; internal")
  })

  it("renders the operator-supplied dark tile URL + attribution", () => {
    authMock.mockReturnValue({
      data: {
        required: false,
        valid: true,
        tile_url_dark: "https://tiles.internal/dark/{z}/{x}/{y}.png",
        tile_attribution_dark: "&copy; internal dark",
      },
    })
    render(<ThemedTileLayer dark />)
    expect(tileCalls[0].url).toBe("https://tiles.internal/dark/{z}/{x}/{y}.png")
    expect(tileCalls[0].attribution).toBe("&copy; internal dark")
  })
})
