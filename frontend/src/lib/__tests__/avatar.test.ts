import { describe, expect, it } from "vitest"
import { colorForPubkey, initialsFor } from "@/lib/avatar"

describe("colorForPubkey", () => {
  it("is deterministic for the same input", () => {
    expect(colorForPubkey("abcdef0123456789")).toBe(colorForPubkey("abcdef0123456789"))
  })

  it("produces an HSL color string", () => {
    expect(colorForPubkey("deadbeef")).toMatch(/^hsl\(\d+, 60%, 50%\)$/)
  })

  it("varies hue for visually-similar prefixes", () => {
    const a = colorForPubkey("0000000000000000aaaa")
    const b = colorForPubkey("0000000000000001aaaa")
    expect(a).not.toBe(b)
  })
})

describe("initialsFor", () => {
  it("returns ? for empty names", () => {
    expect(initialsFor("")).toBe("?")
    expect(initialsFor("   ")).toBe("?")
  })

  it("returns first two letters for single-word names", () => {
    expect(initialsFor("Alpha")).toBe("AL")
  })

  it("returns first + last initial for multi-word names", () => {
    expect(initialsFor("Adrian Lenard")).toBe("AL")
    expect(initialsFor("foo-bar-baz")).toBe("FB")
    expect(initialsFor("snake_case_name")).toBe("SN")
  })
})
