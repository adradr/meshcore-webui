import { describe, it, expect } from "vitest"
import { formatLppValue, lppEntries } from "../lpp"

describe("lppEntries", () => {
  it("extracts entries from a telemetry response", () => {
    const data = {
      pubkey_pre: "aabbccddeeff",
      lpp: [
        { channel: 1, type: "voltage", value: 4.1 },
        { channel: 2, type: "temperature", value: 21.5 },
      ],
    }
    expect(lppEntries(data)).toEqual([
      { channel: 1, type: "voltage", value: 4.1 },
      { channel: 2, type: "temperature", value: 21.5 },
    ])
  })

  it("returns null for non-LPP shapes", () => {
    expect(lppEntries(null)).toBeNull()
    expect(lppEntries({})).toBeNull()
    expect(lppEntries({ lpp: [] })).toBeNull()
    expect(lppEntries({ lpp: "nope" })).toBeNull()
    expect(lppEntries({ lpp: [{ type: "voltage", value: 1 }] })).toBeNull()
  })
})

describe("formatLppValue", () => {
  it("appends known units to numeric values", () => {
    expect(formatLppValue("voltage", 4.1)).toBe("4.1 V")
    expect(formatLppValue("temperature", 21.5)).toBe("21.5 °C")
    expect(formatLppValue("humidity", 60)).toBe("60 %")
  })

  it("leaves unknown types unitless", () => {
    expect(formatLppValue("digital input", 1)).toBe("1")
  })

  it("flattens named-field objects (gps)", () => {
    expect(
      formatLppValue("gps", { latitude: 47.5, longitude: 19.0, altitude: 120 }),
    ).toBe("latitude 47.5, longitude 19, altitude 120")
  })
})
