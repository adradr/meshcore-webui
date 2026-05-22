import { describe, it, expect } from "vitest"
import {
  HASHTAG_RE,
  PSK_HEX_RE,
  parseChannelQrPayload,
} from "../validators"

describe("PSK_HEX_RE", () => {
  it("accepts exactly 32 hex chars (any case)", () => {
    expect(PSK_HEX_RE.test("8b3387e9c5cdea6ac9e5edbaa115cd72")).toBe(true)
    expect(PSK_HEX_RE.test("8B3387E9C5CDEA6AC9E5EDBAA115CD72")).toBe(true)
  })
  it("rejects wrong length / non-hex", () => {
    expect(PSK_HEX_RE.test("8b3387e9c5cdea6ac9e5edbaa115cd7")).toBe(false)
    expect(PSK_HEX_RE.test("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false)
  })
})

describe("HASHTAG_RE", () => {
  it("requires a leading # plus at least one ascii word char", () => {
    expect(HASHTAG_RE.test("#weather")).toBe(true)
    expect(HASHTAG_RE.test("#a_b_2")).toBe(true)
    expect(HASHTAG_RE.test("#")).toBe(false)
    expect(HASHTAG_RE.test("weather")).toBe(false)
    expect(HASHTAG_RE.test("#has space")).toBe(false)
  })
})

describe("parseChannelQrPayload", () => {
  it("parses a valid meshcore channel URI", () => {
    const out = parseChannelQrPayload(
      "meshcore://channel/add?name=Public&secret=8B3387E9C5CDEA6AC9E5EDBAA115CD72",
    )
    expect(out).toEqual({
      name: "Public",
      secret: "8b3387e9c5cdea6ac9e5edbaa115cd72",
    })
  })
  it("rejects wrong scheme", () => {
    expect(
      parseChannelQrPayload(
        "https://meshcore.example/channel/add?name=Public&secret=8b3387e9c5cdea6ac9e5edbaa115cd72",
      ),
    ).toBeNull()
  })
  it("rejects wrong path", () => {
    expect(
      parseChannelQrPayload(
        "meshcore://contact/add?name=X&secret=8b3387e9c5cdea6ac9e5edbaa115cd72",
      ),
    ).toBeNull()
  })
  it("rejects missing / malformed fields", () => {
    expect(
      parseChannelQrPayload("meshcore://channel/add?secret=abcd"),
    ).toBeNull()
    expect(
      parseChannelQrPayload("meshcore://channel/add?name=NoSecret"),
    ).toBeNull()
  })
  it("rejects junk", () => {
    expect(parseChannelQrPayload("")).toBeNull()
    expect(parseChannelQrPayload("not a url")).toBeNull()
  })
})
