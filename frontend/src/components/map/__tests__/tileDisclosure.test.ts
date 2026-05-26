import { describe, expect, it } from "vitest"
import { tilesAreExternal } from "../tileDisclosure"

describe("tilesAreExternal", () => {
  it("returns false when both URLs are undefined (proxy defaults)", () => {
    expect(tilesAreExternal(undefined, undefined)).toBe(false)
  })

  it("returns false when using the built-in proxy paths", () => {
    expect(
      tilesAreExternal(
        "/api/tiles/light/{z}/{x}/{y}.png",
        "/api/tiles/dark/{z}/{x}/{y}.png",
      ),
    ).toBe(false)
  })

  it("returns false for a self-hosted tile server", () => {
    expect(
      tilesAreExternal(
        "https://tiles.internal/{z}/{x}/{y}.png",
        "https://tiles.internal/dark/{z}/{x}/{y}.png",
      ),
    ).toBe(false)
  })

  it("returns true when the light URL points at public OSM", () => {
    expect(
      tilesAreExternal(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "/api/tiles/dark/{z}/{x}/{y}.png",
      ),
    ).toBe(true)
  })

  it("returns true when the dark URL points at public CARTO", () => {
    expect(
      tilesAreExternal(
        "/api/tiles/light/{z}/{x}/{y}.png",
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      ),
    ).toBe(true)
  })

  it("returns true when both URLs point at external CDNs", () => {
    expect(
      tilesAreExternal(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      ),
    ).toBe(true)
  })
})
