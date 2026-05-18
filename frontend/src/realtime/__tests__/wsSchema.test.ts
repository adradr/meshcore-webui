import { describe, it, expect } from "vitest"
import { parseWSMessage } from "../wsSchema"

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
