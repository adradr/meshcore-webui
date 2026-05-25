import { describe, expect, it } from "vitest"
import { tilesAreDefault } from "../tileDisclosure"
import {
  DEFAULT_TILE_URL_DARK,
  DEFAULT_TILE_URL_LIGHT,
} from "@/features/auth/types"

describe("tilesAreDefault", () => {
  it("treats undefined values as defaults so we over-disclose on first paint", () => {
    expect(tilesAreDefault(undefined, undefined)).toBe(true)
  })

  it("returns true when both URLs match the public defaults verbatim", () => {
    expect(
      tilesAreDefault(DEFAULT_TILE_URL_LIGHT, DEFAULT_TILE_URL_DARK),
    ).toBe(true)
  })

  it("returns false once the light URL is overridden (self-hosted tiles)", () => {
    expect(
      tilesAreDefault(
        "https://tiles.internal/{z}/{x}/{y}.png",
        DEFAULT_TILE_URL_DARK,
      ),
    ).toBe(false)
  })

  it("returns false once the dark URL is overridden", () => {
    expect(
      tilesAreDefault(
        DEFAULT_TILE_URL_LIGHT,
        "https://tiles.internal/dark/{z}/{x}/{y}.png",
      ),
    ).toBe(false)
  })
})
