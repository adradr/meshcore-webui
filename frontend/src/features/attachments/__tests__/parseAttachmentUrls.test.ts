import { describe, it, expect } from "vitest"
import { parseAttachmentUrls } from "../parseAttachmentUrls"

const BASE = "https://mesh.example.com"

describe("parseAttachmentUrls", () => {
  it("finds a single short URL", () => {
    const r = parseAttachmentUrls(`check this: ${BASE}/s/aB3kZ9pX`, BASE)
    expect(r.length).toBe(1)
    expect(r[0].slug).toBe("aB3kZ9pX")
  })

  it("ignores foreign hosts", () => {
    const r = parseAttachmentUrls(`see https://evil.com/s/aB3kZ9pX`, BASE)
    expect(r.length).toBe(0)
  })

  it("ignores wrong slug length", () => {
    const r = parseAttachmentUrls(`${BASE}/s/abc`, BASE)
    expect(r.length).toBe(0)
  })

  it("finds multiple", () => {
    const r = parseAttachmentUrls(
      `a ${BASE}/s/aaaaaaaa b ${BASE}/s/bbbbbbbb`,
      BASE,
    )
    expect(r.length).toBe(2)
  })

  it("returns thumbUrl built from base", () => {
    const r = parseAttachmentUrls(`${BASE}/s/aaaaaaaa`, BASE)
    expect(r[0].thumbUrl).toBe(`${BASE}/i/aaaaaaaa/thumb`)
  })
})
