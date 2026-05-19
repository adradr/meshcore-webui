import { describe, it, expect } from "vitest"
import { parseWSMessage, parseWireEvent } from "../wsSchema"

describe("parseWSMessage", () => {
  it("parses contact_message", () => {
    const m = parseWSMessage({
      type: "contact_message",
      payload: { text: "hi", pubkey_prefix: "abc" },
      attributes: {},
    })
    expect(m?.type).toBe("contact_message")
  })

  it("returns null for invalid", () => {
    expect(parseWSMessage({ garbage: true })).toBeNull()
  })
})

describe("parseWireEvent", () => {
  it("defaults topic to 'system' when missing (back-compat)", () => {
    const parsed = parseWireEvent({ type: "acknowledgement", payload: {} })
    expect(parsed.topic).toBe("system")
  })
  it("propagates topic when present", () => {
    const parsed = parseWireEvent({ type: "rx_log_data", payload: {}, topic: "rx_log" })
    expect(parsed.topic).toBe("rx_log")
  })
})
