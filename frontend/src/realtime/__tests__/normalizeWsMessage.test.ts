import { describe, expect, it } from "vitest"
import { normalizeWsMessage } from "../WebSocketProvider"

describe("normalizeWsMessage", () => {
  it("derives ISO timestamp from sender_timestamp (Unix seconds) for channel msg", () => {
    const out = normalizeWsMessage(
      { text: "hi", channel_idx: 2, sender_timestamp: 1779208000 },
      "chan",
    )
    expect(out.timestamp).toBe(new Date(1779208000 * 1000).toISOString())
    expect(out.msg_type).toBe("chan")
    expect(out.channel_idx).toBe(2)
    expect(out.direction).toBe("in")
    expect(out.ack_state).toBe("pending")
    // synthetic id is negative so REST auto-ids never collide
    expect(typeof out.id).toBe("number")
    expect(out.id as number).toBeLessThan(0)
  })

  it("falls back to wall-clock 'now' when sender_timestamp is missing", () => {
    const before = Date.now()
    const out = normalizeWsMessage({ text: "hi", channel_idx: 2 }, "chan")
    const after = Date.now()
    const ts = new Date(out.timestamp as string).getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after + 5)
    // The whole point of this normalization: timestamp must be a valid ISO
    // string that `new Date(...).toISOString()` won't reject downstream.
    expect(() => new Date(out.timestamp as string).toISOString()).not.toThrow()
  })

  it("keeps pubkey_prefix for contact_message (dm)", () => {
    const out = normalizeWsMessage(
      { text: "dm", pubkey_prefix: "deadbeef", sender_timestamp: 1779208000 },
      "dm",
    )
    expect(out.msg_type).toBe("dm")
    expect(out.channel_idx).toBeNull()
    expect(out.pubkey_prefix).toBe("deadbeef")
    expect(out.direction).toBe("in")
  })

  it("output is always shaped so MessageList.buildTimeline cannot crash on it", () => {
    // This is the regression guard for the actual channel-page crash:
    //   new Date(undefined).toISOString() throws RangeError: Invalid time value
    // The fixture has NO sender_timestamp on purpose.
    const out = normalizeWsMessage({ text: "x", channel_idx: 1 }, "chan")
    const d = new Date(out.timestamp as string)
    expect(Number.isNaN(d.getTime())).toBe(false)
    // Reproduces the exact call from MessageList.tsx:96 that was crashing.
    expect(() => d.toISOString().slice(0, 10)).not.toThrow()
  })
})
