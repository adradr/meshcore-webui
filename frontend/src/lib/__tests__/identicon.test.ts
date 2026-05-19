import { describe, expect, it } from "vitest"
import { identiconSvg, identiconBgColor } from "@/lib/identicon"

describe("identiconSvg", () => {
  it("is deterministic", () => {
    const seed = "ab" + "00".repeat(31)
    expect(identiconSvg(seed)).toBe(identiconSvg(seed))
  })

  it("produces different SVG for different seeds", () => {
    expect(identiconSvg("aaaa")).not.toBe(identiconSvg("bbbb"))
  })

  it("is horizontally symmetric (the rendered fill pattern mirrors)", () => {
    const svg = identiconSvg("test")
    // size defaults to 100 → cells are 20 wide; left col x="0", right col x="80"
    const left0 = (svg.match(/x="0"/g) ?? []).length
    const right0 = (svg.match(/x="80"/g) ?? []).length
    expect(left0).toBe(right0)
    // second column from left x="20" mirrors x="60"
    const left1 = (svg.match(/x="20"/g) ?? []).length
    const right1 = (svg.match(/x="60"/g) ?? []).length
    expect(left1).toBe(right1)
  })

  it("never contains emoji or text glyphs (regression for the rectangle-X bug)", () => {
    const svg = identiconSvg("🇱🇻 Mail03")
    expect(svg).not.toMatch(/<text/)
    // only <svg>, <g>, and <rect> elements (open or close, self-closing)
    expect(svg.replace(/<\/?(svg|g|rect)[^>]*\/?>/g, "")).toBe("")
  })

  it("honors a custom size in the viewBox and dimensions", () => {
    const svg = identiconSvg("size-test", 40)
    expect(svg).toContain('viewBox="0 0 40 40"')
    expect(svg).toContain('width="40"')
    expect(svg).toContain('height="40"')
  })

  it("includes an HSL fill derived from the seed", () => {
    const svg = identiconSvg("color-seed")
    expect(svg).toMatch(/fill="hsl\(\d+, 60%, 45%\)"/)
  })
})

describe("identiconBgColor", () => {
  it("returns an HSL string", () => {
    expect(identiconBgColor("x")).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
  })

  it("is deterministic", () => {
    expect(identiconBgColor("same-seed")).toBe(identiconBgColor("same-seed"))
  })
})
