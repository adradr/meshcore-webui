import { describe, expect, it } from "vitest"
import { matchIncoming } from "../chat"

const FULL = "ab".repeat(32)
const PREFIX = FULL.slice(0, 12)

describe("matchIncoming — messages-topic payload routing", () => {
  it("matches a DM by the enriched full pubkey (case-insensitive)", () => {
    expect(
      matchIncoming({ text: "hi", pubkey: FULL.toUpperCase() }, FULL, undefined),
    ).toEqual({ contactPubKey: FULL })
  })

  it("matches a DM by legacy prefix when no full pubkey is present", () => {
    expect(
      matchIncoming({ text: "hi", pubkey_prefix: PREFIX }, FULL, undefined),
    ).toEqual({ contactPubKey: FULL })
  })

  it("rejects a DM whose full pubkey differs even if the prefix matches the route", () => {
    const other = "cd".repeat(32)
    expect(
      matchIncoming({ text: "hi", pubkey: other, pubkey_prefix: PREFIX }, FULL, undefined),
    ).toBeNull()
  })

  it("rejects a DM for a different conversation", () => {
    expect(
      matchIncoming({ text: "hi", pubkey_prefix: "deadbeef0000" }, FULL, undefined),
    ).toBeNull()
  })

  it("matches a channel message on the active channel", () => {
    expect(matchIncoming({ text: "yo", channel_idx: 3 }, undefined, 3)).toEqual({
      channelIdx: 3,
    })
    expect(matchIncoming({ text: "yo", channel_idx: 4 }, undefined, 3)).toBeNull()
  })

  it("ignores non-message payloads on the topic (acks, adverts)", () => {
    expect(matchIncoming({ code: "beef0001" }, FULL, undefined)).toBeNull()
    expect(matchIncoming({ public_key: FULL }, FULL, undefined)).toBeNull()
    expect(matchIncoming(null, FULL, 0)).toBeNull()
    expect(matchIncoming("str", FULL, 0)).toBeNull()
  })

  it("returns null when no conversation is active", () => {
    expect(
      matchIncoming({ text: "hi", pubkey: FULL }, undefined, undefined),
    ).toBeNull()
  })
})
