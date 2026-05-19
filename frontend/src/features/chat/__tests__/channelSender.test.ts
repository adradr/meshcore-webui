import { describe, expect, it } from "vitest"
import { parseChannelSender } from "@/features/chat/channelSender"
import type { Contact } from "@/features/contacts/queries"

const contacts: Record<string, Contact> = {
  alexpk: { public_key: "alexpk0000000000", adv_name: "Alex" },
  pbpk: { public_key: "pbpk000000000000", adv_name: "PBalazs/M" },
  daerpk: { public_key: "daerpk0000000000", adv_name: "Dacr 📢" },
}

describe("parseChannelSender", () => {
  it("returns name + body + publicKey when sender matches a contact", () => {
    const r = parseChannelSender("Alex: hello", contacts)
    expect(r).not.toBeNull()
    expect(r!.name).toBe("Alex")
    expect(r!.body).toBe("hello")
    expect(r!.publicKey).toBe("alexpk0000000000")
  })

  it("returns name + body without publicKey when sender unknown", () => {
    const r = parseChannelSender("Stranger: hi", contacts)
    expect(r).not.toBeNull()
    expect(r!.name).toBe("Stranger")
    expect(r!.body).toBe("hi")
    expect(r!.publicKey).toBeUndefined()
  })

  it("returns null when there is no colon-prefix", () => {
    expect(parseChannelSender("no colon here", contacts)).toBeNull()
  })

  it("does not false-match bare hour numbers", () => {
    // We treat "14" (likely from a clipped "14:30") as not-a-sender.
    expect(parseChannelSender("14:30 meeting starts", contacts)).toBeNull()
  })

  it("parses names containing slashes and special chars", () => {
    const r = parseChannelSender("PBalazs/M: @[Dacr 📢] barcsak", contacts)
    expect(r).not.toBeNull()
    expect(r!.name).toBe("PBalazs/M")
    expect(r!.body).toBe("@[Dacr 📢] barcsak")
    expect(r!.publicKey).toBe("pbpk000000000000")
  })

  it("preserves multi-line bodies", () => {
    const r = parseChannelSender("Alex: line1\nline2", contacts)
    expect(r).not.toBeNull()
    expect(r!.body).toBe("line1\nline2")
  })

  it("resolves case-insensitively when exact match fails", () => {
    const r = parseChannelSender("alex: hi", contacts)
    expect(r).not.toBeNull()
    expect(r!.name).toBe("alex")
    expect(r!.publicKey).toBe("alexpk0000000000")
  })

  it("does not parse leading URL as a sender (colon must be followed by space)", () => {
    // Leading URLs in channel msgs are rare; the "colon + whitespace"
    // requirement happens to filter "https://..." out cleanly.
    const r = parseChannelSender("https://example.com/api: hi", contacts)
    expect(r).toBeNull()
  })

  it("documented caveat: 'word: rest' where word looks URL-ish still parses", () => {
    // If someone writes "https: hi" (colon + space) we will pull "https" as
    // the name. This is intentional / documented — too rare to special-case.
    const r = parseChannelSender("https: hi there", contacts)
    expect(r).not.toBeNull()
    expect(r!.name).toBe("https")
  })

  it("returns name only when contacts map is undefined", () => {
    const r = parseChannelSender("Alex: hello", undefined)
    expect(r).not.toBeNull()
    expect(r!.name).toBe("Alex")
    expect(r!.publicKey).toBeUndefined()
  })
})
